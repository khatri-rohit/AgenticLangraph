/**
 * Human-in-the-loop (HITL) types shared by the v2 graph, API route, and UI.
 *
 * Policy flags travel in LangGraph `config.configurable` (snake_case) on every run.
 * Resume payloads travel in `Command({ resume })` (see LangGraph dynamic interrupts).
 *
 * @see https://docs.langchain.com/oss/javascript/langgraph/interrupts
 */

import { z } from 'zod';

/** User decision when resuming after `interrupt()` in the human_approval node. */
export type ToolApprovalDecision =
    | { action: 'approve'; toolCallId: string }
    | { action: 'deny'; reason?: string; toolCallId: string };

export const ToolApprovalDecisionSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('approve') }),
    z.object({
        action: z.literal('deny'),
        reason: z.string().optional(),
    }),
]);

/** POST body for `/api/chat/v2` (camelCase at the HTTP boundary). */
export const ChatV2PostBodySchema = z.object({
    messages: z.array(z.unknown()).optional(),
    threadId: z.string().min(1).optional(),
    approval: z.array(ToolApprovalDecisionSchema).optional(),
    requireToolApproval: z.boolean().optional(),
    enabledTools: z.array(z.string()).optional(),
    autoApproveTools: z.array(z.string()).optional(),
});

export function hitlConfigurableFromApi(body: {
    threadId?: string;
    requireToolApproval?: boolean;
    enabledTools?: string[];
    autoApproveTools?: string[];
}): HitlConfigurable {
    return {
        thread_id: body.threadId ?? 'default',
        require_tool_approval: body.requireToolApproval ?? false,
        enabled_tools: body.enabledTools,
        auto_approve_tools: body.autoApproveTools ?? [],
    };
}

/** Zero-width placeholder user turns used only to trigger a resume POST from `useChat`. */
export const RESUME_PLACEHOLDER_TEXT = '\u200b';

export function isResumePlaceholderUserMessage(
    parts: {
        type: string;
        text?: string;
    }[],
): boolean {
    return parts.every((p) => {
        if (p.type !== 'text') return false;
        const text = p.text?.replace(/\u200b/g, '').trim() ?? '';
        return text.length === 0;
    });
}

/** Prefix on ToolMessage content when the user denied execution (routing hint). */
export const TOOL_DENIAL_PREFIX = '[denied]';

export function isToolDenialContent(content: unknown): boolean {
    return String(content).startsWith(TOOL_DENIAL_PREFIX);
}

/** Payload surfaced to the client while the graph is paused at human_approval. */
export type ToolApprovalInterruptPayload = {
    kind: 'tool_approval';
    toolCalls: Array<{
        id?: string;
        name: string;
        args: Record<string, unknown>;
    }>;
};

/** Runtime flags from the client (see POST /api/chat/v2). */
export type HitlConfigurable = {
    thread_id?: string;
    /** When true, tool calls pause for approve/deny unless auto-approved. */
    require_tool_approval?: boolean;
    /** Tool names the model may bind (e.g. get_weather, firecrawl_search). */
    enabled_tools?: string[];
    /** Subset of enabled tools that run without an interrupt. */
    auto_approve_tools?: string[];
};

export const DEFAULT_ENABLED_TOOLS = [
    'get_weather',
    'firecrawl_search',
] as const;
