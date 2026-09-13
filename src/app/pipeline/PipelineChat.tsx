/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Markdown } from './Markdown';
import { isInterrupted, INTERRUPT } from '@langchain/langgraph';

import {
    DEFAULT_ENABLED_TOOLS,
    RESUME_PLACEHOLDER_TEXT,
    isResumePlaceholderUserMessage,
    type ToolApprovalDecision,
} from '@/lib/hitl';

function renderMessagePart(part: UIMessage['parts'][number], key: string) {
    if (part.type === 'text') {
        return part.text.trim() ? (
            <Markdown key={key}>{part.text}</Markdown>
        ) : null;
    }

    if (part.type.startsWith('tool-')) {
        const toolPart = part as {
            type: string;
            toolCallId: string;
            state: string;
            input?: unknown;
            output?: unknown;
            errorText?: string;
        };
        const toolName = toolPart.type.replace(/^tool-/, '');
        const label =
            toolPart.state === 'output-available'
                ? 'complete'
                : toolPart.state === 'output-error'
                  ? 'error'
                  : toolPart.state === 'approval-requested'
                    ? 'awaiting approval'
                    : 'running';

        return (
            <div
                key={key}
                className="rounded-lg border bg-white p-3 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800"
            >
                <div className="mb-1 flex items-center gap-2">
                    <span className="font-medium capitalize">{toolName}</span>
                    <span
                        className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${
                            label === 'complete'
                                ? 'bg-green-500 text-white'
                                : label === 'error'
                                  ? 'bg-red-500 text-white'
                                  : label === 'awaiting approval'
                                    ? 'bg-amber-500 text-white'
                                    : 'bg-blue-500 text-white animate-pulse'
                        }`}
                    >
                        {label}
                    </span>
                </div>
                {toolPart.input != null && (
                    <pre className="mt-2 overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">
                        {JSON.stringify(toolPart.input, null, 2)}
                    </pre>
                )}
                {toolPart.output != null && (
                    <pre className="mt-2 overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">
                        {JSON.stringify(toolPart.output, null, 2)}
                    </pre>
                )}
                {toolPart.errorText && (
                    <p className="mt-2 text-red-600">{toolPart.errorText}</p>
                )}
            </div>
        );
    }

    return null;
}

/** Tool parts waiting on human approval (HITL interrupt before execution). */
function hasPendingToolApproval(messages: UIMessage[]): UIMessage[] | boolean {
    // console.log(messages);
    let onlyLastAssistant = false;
    const lastAssistant = [...messages].reverse().filter((message) => {
        if (message.role !== 'assistant') {
            onlyLastAssistant = true;
        }
        if (onlyLastAssistant) return false;
        return message.role === 'assistant';
    });
    // console.log(lastAssistant);
    if (lastAssistant.length === 0) return false;
    // console.log(
    //     lastAssistant.filter((message) => {
    //         return (
    //             message.parts.map((part) => {
    //                 if (part.type.startsWith('dynamic-tool')) {
    //                     return true;
    //                 }
    //                 return false;
    //             }).length > 0
    //         );
    //     }),
    // );
    return lastAssistant.filter((message) => {
        return (
            message.parts.map((part) => {
                if (part.type.startsWith('dynamic-tool')) {
                    return (
                        (part as any)?.state !== 'output-available' &&
                        (part as any)?.state !== 'output-error'
                    );
                }
                return false;
            }).length > 0
        );
    });

    // if (!lastAssistant) return false;
    // return lastAssistant.filter((p) => {
    //     if (!p.type.startsWith('dynamic-tool')) return false;
    //     console.log(p);
    //     const state = (p as { state?: string }).state;
    //     return state !== 'output-available' && state !== 'output-error';
    // });
}

export function PipelineChat() {
    const [input, setInput] = useState('');
    const [hitlEnabled, setHitlEnabled] = useState(true);
    /** When set, the next sendMessage issues a resume POST (Approve/Deny). */
    const [approvalToSend, setApprovalToSend] = useState<
        ToolApprovalDecision[]
    >([]);

    const transport = useMemo(() => {
        const enabledTools = [...DEFAULT_ENABLED_TOOLS];
        const autoApproveTools = hitlEnabled ? [] : [...DEFAULT_ENABLED_TOOLS];

        return new DefaultChatTransport({
            api: '/api/chat/v2',
            prepareSendMessagesRequest: ({ id, messages }) => {
                console.log('approvalToSend', approvalToSend);
                if (approvalToSend.length > 0) {
                    return {
                        body: {
                            threadId: id,
                            approval: approvalToSend,
                            requireToolApproval: hitlEnabled,
                            enabledTools,
                            autoApproveTools,
                        },
                    };
                }

                const visibleMessages = messages.filter(
                    (m) =>
                        m.role !== 'user' ||
                        !isResumePlaceholderUserMessage(m.parts),
                );

                return {
                    body: {
                        messages: visibleMessages,
                        threadId: id,
                        requireToolApproval: hitlEnabled,
                        enabledTools,
                        autoApproveTools,
                    },
                };
            },
        });
    }, [hitlEnabled, approvalToSend]);

    const { messages, sendMessage, status } = useChat({
        id: 'pipeline-chat',
        transport,
    });

    const isBusy = status === 'submitted' || status === 'streaming';
    const awaitingApproval =
        hitlEnabled &&
        !isBusy &&
        Array.isArray(hasPendingToolApproval(messages)) &&
        (hasPendingToolApproval(messages) as UIMessage[]).length > 0
            ? (hasPendingToolApproval(messages) as UIMessage[])
            : false;
    const showApprovalBar = awaitingApproval;

    const resumeWith = (decision: ToolApprovalDecision) => {
        setApprovalToSend((prev) => [...prev, decision]);
        if (
            Array.isArray(hasPendingToolApproval(messages)) &&
            (hasPendingToolApproval(messages) as UIMessage[]).length ===
                approvalToSend.length
        ) {
            console.log('All Approvals Sent', approvalToSend.length);
            flushSync(() => setApprovalToSend(approvalToSend));
            void sendMessage({ text: RESUME_PLACEHOLDER_TEXT });
            queueMicrotask(() => setApprovalToSend(approvalToSend));
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const text = input.trim();
        if (!text || isBusy) return;
        setInput('');
        void sendMessage({ text });
    };

    return (
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-8">
            <header>
                <h1 className="text-2xl font-bold">LangGraph Chat (v2)</h1>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    AI SDK + human-in-the-loop before tool execution
                </p>
            </header>

            <div className="flex flex-wrap items-center gap-3 text-sm">
                <button
                    type="button"
                    onClick={() => setHitlEnabled((prev) => !prev)}
                    className={`rounded-lg px-4 py-2 font-medium transition-colors ${
                        hitlEnabled
                            ? 'bg-amber-500 text-white hover:bg-amber-600'
                            : 'bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100'
                    }`}
                >
                    {hitlEnabled
                        ? 'HITL on (tools need approval)'
                        : 'HITL off (tools auto-run)'}
                </button>
                <span className="text-gray-500 dark:text-gray-400">
                    Tools: {DEFAULT_ENABLED_TOOLS.join(', ')}
                </span>
            </div>

            {showApprovalBar &&
                Array.isArray(awaitingApproval) &&
                (awaitingApproval as UIMessage[]).length > 0 &&
                showApprovalBar.map((message) =>
                    message.parts.map((part) =>
                        part.type === 'dynamic-tool' ? (
                            <div
                                key={part.toolCallId}
                                className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40"
                            >
                                <p className="flex-1 text-sm text-amber-900 dark:text-amber-100">
                                    Approve running the pending tool call(s)?
                                    for {part.toolCallId}
                                </p>
                                <button
                                    type="button"
                                    onClick={() =>
                                        resumeWith({
                                            action: 'approve',
                                            toolCallId: part.toolCallId,
                                        })
                                    }
                                    className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                                >
                                    Approve
                                </button>
                                <button
                                    type="button"
                                    onClick={() =>
                                        resumeWith({
                                            action: 'deny',
                                            reason: 'User denied in chat UI',
                                            toolCallId: part.toolCallId,
                                        })
                                    }
                                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                                >
                                    Deny
                                </button>
                            </div>
                        ) : null,
                    ),
                )}

            {isBusy && (
                <p className="text-sm text-blue-600 animate-pulse dark:text-blue-400">
                    Agent running…
                </p>
            )}

            {messages.length > 0 && (
                <section className="flex flex-col gap-4">
                    {messages.map((message) => (
                        <div
                            key={message.id}
                            className={
                                message.role === 'user'
                                    ? 'rounded-lg bg-zinc-100 px-4 py-2 dark:bg-zinc-800'
                                    : 'flex flex-col gap-2'
                            }
                        >
                            {message.role === 'user' &&
                            isResumePlaceholderUserMessage(
                                message.parts,
                            ) ? null : (
                                <>
                                    <span className="text-xs font-semibold uppercase text-gray-500">
                                        {message.role}
                                    </span>
                                    {message.parts.map((part, i) =>
                                        renderMessagePart(
                                            part,
                                            `${message.id}-${i}`,
                                        ),
                                    )}
                                </>
                            )}
                        </div>
                    ))}
                </section>
            )}

            <form onSubmit={handleSubmit} className="mt-auto flex gap-2">
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask the pipeline something…"
                    className="flex-1 rounded-lg border px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                    disabled={isBusy || !!awaitingApproval}
                />
                <button
                    type="submit"
                    disabled={isBusy || !!awaitingApproval || !input.trim()}
                    className="rounded-lg bg-blue-500 px-5 py-2 font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
                >
                    {isBusy ? 'Running…' : 'Send'}
                </button>
            </form>
        </div>
    );
}
