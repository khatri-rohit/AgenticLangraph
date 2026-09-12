'use client';

import { useState } from 'react';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { useStream } from '@langchain/react';
import type { ChatPipeline } from '@/graph/chatpipline';
import { PipelineProgress } from './PipelineProgress';
import { NodeCard } from './NodeCard';
import { Markdown } from './Markdown';

const AGENT_URL = 'http://localhost:2024';

export function PipelineChat() {
    const stream = useStream<ChatPipeline>({
        apiUrl: AGENT_URL,
        assistantId: 'chatpipline',
    });

    const graphNodes = [...stream.subgraphs.values()];
    const firstIncompleteIdx = graphNodes.findIndex(
        (n) => n.status !== 'complete',
    );
    const [input, setInput] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const text = input.trim();
        if (!text || stream.isLoading) return;
        setInput('');
        void stream.submit({ messages: [new HumanMessage(text)] });
    };

    return (
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-8">
            <header>
                <h1 className="text-2xl font-bold">LangGraph Chat</h1>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    chatbot + tool calls
                </p>
            </header>

            {/* Conversation transcript */}
            {stream.messages.length > 0 && (
                <section className="flex flex-col gap-3">
                    {stream.messages.map((msg) => {
                        if (AIMessage.isInstance(msg)) {
                            return <Markdown key={msg.id}>{msg.text}</Markdown>;
                        }
                        return (
                            <p
                                key={msg.id}
                                className="text-gray-700 dark:text-gray-300"
                            >
                                {msg.text}
                            </p>
                        );
                    })}
                </section>
            )}

            {/* Per-node pipeline view */}
            <section className="flex flex-col gap-3">
                <PipelineProgress
                    nodes={graphNodes}
                    isLoading={stream.isLoading}
                />
                <div className="space-y-3">
                    {graphNodes.map((node, i) => {
                        const isComplete = node.status === 'complete';
                        const isRunning =
                            stream.isLoading &&
                            !isComplete &&
                            firstIncompleteIdx === i;
                        if (!isComplete && !isRunning) return null;
                        return (
                            <NodeCard
                                key={node.id}
                                node={node}
                                stream={stream}
                            />
                        );
                    })}
                </div>
            </section>

            {/* Submit form */}
            <form onSubmit={handleSubmit} className="mt-auto flex gap-2">
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask the pipeline something…"
                    className="flex-1 rounded-lg border px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                    disabled={stream.isLoading}
                />
                <button
                    type="submit"
                    disabled={stream.isLoading || !input.trim()}
                    className="rounded-lg bg-blue-500 px-5 py-2 font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
                >
                    {stream.isLoading ? 'Running…' : 'Send'}
                </button>
            </form>
        </div>
    );
}
