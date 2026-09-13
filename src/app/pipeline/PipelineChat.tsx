'use client';

import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Markdown } from './Markdown';

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

export function PipelineChat() {
    const [input, setInput] = useState('');
    const { messages, sendMessage, status } = useChat({
        id: 'pipeline-chat',
        transport: new DefaultChatTransport({
            api: '/api/chat/v1',
            prepareSendMessagesRequest: ({ id, messages }) => ({
                body: { messages, threadId: id },
            }),
        }),
    });

    const isBusy = status === 'submitted' || status === 'streaming';

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
                <h1 className="text-2xl font-bold">LangGraph Chat</h1>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    Vercel AI SDK + LangGraph (chatbot + tools)
                </p>
            </header>

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
                            <span className="text-xs font-semibold uppercase text-gray-500">
                                {message.role}
                            </span>
                            {message.parts.map((part, i) =>
                                renderMessagePart(part, `${message.id}-${i}`),
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
                    disabled={isBusy}
                />
                <button
                    type="submit"
                    disabled={isBusy || !input.trim()}
                    className="rounded-lg bg-blue-500 px-5 py-2 font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
                >
                    {isBusy ? 'Running…' : 'Send'}
                </button>
            </form>
        </div>
    );
}
