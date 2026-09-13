import type { HitlConfigurable } from '@/lib/hitl';

/** Stream modes required by `@ai-sdk/langchain` `toUIMessageStream` for chat UIs. */
export const GRAPH_CHAT_STREAM_MODES = [
    'values',
    'messages',
    'updates',
] as const;

export type GraphChatStreamMode = (typeof GRAPH_CHAT_STREAM_MODES)[number];

/**
 * Options passed to `graph.stream()` from Next.js API routes.
 *
 * @see https://docs.langchain.com/oss/javascript/langgraph/interrupts — `thread_id` must be stable
 *      across the interrupt and `Command({ resume })` on the same conversation.
 */
export function createGraphStreamOptions(configurable: HitlConfigurable) {
    return {
        streamMode: [...GRAPH_CHAT_STREAM_MODES] as GraphChatStreamMode[],
        configurable: {
            thread_id: configurable.thread_id ?? 'default',
            require_tool_approval: configurable.require_tool_approval ?? false,
            enabled_tools: configurable.enabled_tools,
            auto_approve_tools: configurable.auto_approve_tools ?? [],
        },
    };
}
