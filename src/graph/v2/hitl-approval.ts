/**
 * Sequential HITL is a graph cycle, not a for-loop of interrupt() calls.
 *
 * LangGraph restarts a node from the top on resume and only checkpoints when
 * the node returns. Running tools inside the interrupt node re-executes them
 * on every later resume. One interrupt per visit; tool_call runs the side effect.
 *
 * @see https://docs.langchain.com/oss/javascript/langgraph/interrupts
 */

import { interrupt } from '@langchain/langgraph';
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type {
    ToolApprovalDecision,
    ToolApprovalInterruptPayload,
} from '@/lib/hitl';
import { TOOL_DENIAL_PREFIX } from '@/lib/hitl';

/** Active HITL strategy. Batch remains commented at the bottom of this file. */
export const HITL_APPROVAL_MODE = 'sequential' as const;

export type ToolCallLike = {
    id?: string;
    name: string;
    args: Record<string, unknown>;
};

/** Tool calls on the latest assistant message that still have no ToolMessage. */
export function getPendingToolCalls(messages: BaseMessage[]): ToolCallLike[] {
    let aiIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (AIMessage.isInstance(message) && (message.tool_calls?.length ?? 0) > 0) {
            aiIndex = i;
            break;
        }
    }
    if (aiIndex < 0) return [];

    const ai = messages[aiIndex];
    if (!AIMessage.isInstance(ai) || !ai.tool_calls?.length) return [];

    const done = new Set<string>();
    for (let i = aiIndex + 1; i < messages.length; i++) {
        const message = messages[i];
        if (ToolMessage.isInstance(message) && message.tool_call_id) {
            done.add(message.tool_call_id);
        }
    }

    return ai.tool_calls
        .filter((tc) => Boolean(tc.id) && !done.has(tc.id as string))
        .map((tc) => ({
            id: tc.id,
            name: tc.name,
            args: (tc.args ?? {}) as Record<string, unknown>,
        }));
}

function toolMessageContent(result: unknown): string {
    if (typeof result === 'string') return result;
    return JSON.stringify(result);
}

export function denyToolCall(tc: ToolCallLike, reason: string): ToolMessage {
    return new ToolMessage({
        content: `${TOOL_DENIAL_PREFIX} ${reason}`,
        tool_call_id: tc.id ?? '',
        name: tc.name,
    });
}

export async function executeToolCall(
    tc: ToolCallLike,
    toolsByName: Map<string, StructuredToolInterface>,
): Promise<ToolMessage> {
    const toolCallId = tc.id ?? '';
    const tool = toolsByName.get(tc.name);
    if (!tool) {
        return new ToolMessage({
            content: `Unknown tool: ${tc.name}`,
            tool_call_id: toolCallId,
            name: tc.name,
        });
    }

    try {
        const result = await tool.invoke(tc.args);
        return new ToolMessage({
            content: toolMessageContent(result),
            tool_call_id: toolCallId,
            name: tc.name,
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        return new ToolMessage({
            content: `Tool error: ${message}`,
            tool_call_id: toolCallId,
            name: tc.name,
        });
    }
}

/**
 * Pause for the next pending tool. Does not execute it.
 * Approve → empty update (tool_call node runs it). Deny → ToolMessage, then route.
 */
export function interruptSequentialTool(
    tc: ToolCallLike,
): { messages: ToolMessage[] } | Record<string, never> {
    const toolCall = {
        id: tc.id,
        name: tc.name,
        args: tc.args,
    };

    const decision = interrupt<
        ToolApprovalInterruptPayload,
        ToolApprovalDecision
    >({
        kind: 'tool_approval',
        mode: 'sequential',
        toolCall,
        // @ai-sdk/langchain only maps HITL when `__interrupt__.value.actionRequests` exists.
        actionRequests: [
            { name: tc.name, args: tc.args, id: tc.id },
        ],
    });

    const expectedId = tc.id ?? '';
    if (decision.toolCallId !== expectedId) {
        return {
            messages: [
                denyToolCall(
                    tc,
                    'Resume decision did not match the pending tool call.',
                ),
            ],
        };
    }

    if (decision.action === 'deny') {
        const reason =
            decision.reason?.trim() || 'User denied tool execution.';
        return { messages: [denyToolCall(tc, reason)] };
    }

    return {};
}

/*
 * BATCH GATE (disabled) — one interrupt for the whole assistant tool-call batch.
 *
 * Enable by setting HITL_APPROVAL_MODE to 'batch' and wiring human_approval to
 * interrupt once, then letting tool_call run every remaining pending tool.
 *
 * export function interruptBatchTools(toolCalls: ToolCallLike[]) {
 *     return interrupt<ToolApprovalInterruptPayload, ToolApprovalDecision>({
 *         kind: 'tool_approval',
 *         mode: 'batch',
 *         toolCalls: toolCalls.map((tc) => ({
 *             id: tc.id,
 *             name: tc.name,
 *             args: tc.args,
 *         })),
 *         actionRequests: toolCalls.map((tc) => ({
 *             name: tc.name,
 *             args: tc.args,
 *             id: tc.id,
 *         })),
 *     });
 * }
 */
