'use client';

import { useMemo, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Markdown } from './Markdown';
import {
    DEFAULT_ENABLED_TOOLS,
    RESUME_PLACEHOLDER_TEXT,
    isResumePlaceholderUserMessage,
    type ToolApprovalDecision,
} from '@/lib/hitl';

type PendingToolPart = {
    type: string;
    toolCallId: string;
    state?: string;
    input?: unknown;
};

function isPendingToolPart(part: UIMessage['parts'][number]): boolean {
    const isTool =
        part.type === 'dynamic-tool' || part.type.startsWith('tool-');
    if (!isTool) return false;
    const state = (part as PendingToolPart).state;
    return state !== 'output-available' && state !== 'output-error';
}

/** First tool on the latest assistant message that still needs approve/deny (sequential HITL). */
function getCurrentPendingToolPart(
    messages: UIMessage[],
): PendingToolPart | null {
    const lastAssistant = [...messages]
        .reverse()
        .find((m) => m.role === 'assistant');
    if (!lastAssistant) return null;

    for (const part of lastAssistant.parts) {
        if (isPendingToolPart(part)) {
            return part as PendingToolPart;
        }
    }
    return null;
}

function renderMessagePart(part: UIMessage['parts'][number], key: string) {
    if (part.type === 'text') {
        return part.text.trim() ? (
            <Markdown key={key}>{part.text}</Markdown>
        ) : null;
    }

    if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
        const toolPart = part as PendingToolPart & {
            output?: unknown;
            errorText?: string;
        };
        const toolName =
            part.type === 'dynamic-tool'
                ? 'tool'
                : toolPart.type.replace(/^tool-/, '');
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
                {'output' in toolPart && toolPart.output != null && (
                    <pre className="mt-2 overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">
                        {JSON.stringify(toolPart.output, null, 2)}
                    </pre>
                )}
                {'errorText' in toolPart && toolPart.errorText && (
                    <p className="mt-2 text-red-600">{toolPart.errorText}</p>
                )}
            </div>
        );
    }

    return null;
}

export function PipelineChat() {
    const [input, setInput] = useState('');
    const [hitlEnabled, setHitlEnabled] = useState(true);

    const transport = useMemo(
        () =>
            new DefaultChatTransport({
                api: '/api/chat/v2',
                prepareSendMessagesRequest: ({ id, messages, body }) => {
                    const enabledTools = [...DEFAULT_ENABLED_TOOLS];
                    const autoApproveTools = hitlEnabled
                        ? []
                        : [...DEFAULT_ENABLED_TOOLS];
                    const approval = (
                        body as { approval?: ToolApprovalDecision } | undefined
                    )?.approval;
                    if (approval) {
                        return {
                            body: {
                                threadId: id,
                                approval,
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
            }),
        [hitlEnabled],
    );

    const { messages, sendMessage, status } = useChat({
        id: 'pipeline-chat',
        transport,
    });

    const isBusy = status === 'submitted' || status === 'streaming';
    const pendingTool =
        hitlEnabled && !isBusy ? getCurrentPendingToolPart(messages) : null;

    const resumeWith = (decision: ToolApprovalDecision) => {
        void sendMessage(
            { text: RESUME_PLACEHOLDER_TEXT },
            { body: { approval: decision } },
        );
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
                    Sequential HITL: approve or deny one tool at a time; each
                    approval runs that tool before the next prompt.
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
                        ? 'HITL on (per-tool approval)'
                        : 'HITL off (tools auto-run)'}
                </button>
                <span className="text-gray-500 dark:text-gray-400">
                    Tools: {DEFAULT_ENABLED_TOOLS.join(', ')}
                </span>
            </div>

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

            {pendingTool && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40">
                    <p className="flex-1 text-sm text-amber-900 dark:text-amber-100">
                        Approve running this tool call? (
                        <span className="font-mono text-xs">
                            {pendingTool.toolCallId}
                        </span>
                        )
                    </p>
                    <button
                        type="button"
                        onClick={() =>
                            resumeWith({
                                action: 'approve',
                                toolCallId: pendingTool.toolCallId,
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
                                toolCallId: pendingTool.toolCallId,
                                reason: 'User denied in chat UI',
                            })
                        }
                        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                    >
                        Deny
                    </button>
                </div>
            )}

            <form onSubmit={handleSubmit} className="mt-auto flex gap-2">
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask the pipeline something…"
                    className="flex-1 rounded-lg border px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                    disabled={isBusy || !!pendingTool}
                />
                <button
                    type="submit"
                    disabled={isBusy || !!pendingTool || !input.trim()}
                    className="rounded-lg bg-blue-500 px-5 py-2 font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
                >
                    {isBusy ? 'Running…' : 'Send'}
                </button>
            </form>
        </div>
    );
}
