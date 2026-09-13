import { toBaseMessages, toUIMessageStream } from '@ai-sdk/langchain';
import { createUIMessageStreamResponse, type UIMessage } from 'ai';
import { graph } from '@/graph/v2/chatpipline';
import { Command } from '@langchain/langgraph';
import {
    ChatV2PostBodySchema,
    hitlConfigurableFromApi,
    type ToolApprovalDecision,
} from '@/lib/hitl';
import { createGraphStreamOptions } from '@/lib/graph-run-config';

export const maxDuration = 60;
export type { ToolApprovalDecision };

export async function POST(req: Request) {
    let json: unknown;

    try {
        json = await req.json();
    } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = ChatV2PostBodySchema.safeParse(json);
    if (!parsed.success) {
        return Response.json(
            { error: 'Invalid request', details: parsed.error.flatten() },
            { status: 400 },
        );
    }

    const {
        messages,
        threadId,
        approval,
        requireToolApproval,
        enabledTools,
        autoApproveTools,
    } = parsed.data;

    const configurable = hitlConfigurableFromApi({
        threadId,
        requireToolApproval,
        enabledTools,
        autoApproveTools,
    });

    const streamOptions = createGraphStreamOptions(configurable);

    try {
        // Resume: same `thread_id` as the run that hit interrupt(); input is only Command(resume).
        // @see https://docs.langchain.com/oss/javascript/langgraph/interrupts#resuming-interrupts

        console.log('approval', approval);
        if (approval) {
            const stream = await graph.stream(
                new Command({ resume: approval }),
                streamOptions,
            );

            return createUIMessageStreamResponse({
                stream: toUIMessageStream(stream),
            });
        }

        if (!messages?.length) {
            return Response.json(
                { error: 'messages required when not resuming' },
                { status: 400 },
            );
        }

        const langchainMessages = await toBaseMessages(messages as UIMessage[]);

        const stream = await graph.stream(
            { messages: langchainMessages },
            streamOptions,
        );

        return createUIMessageStreamResponse({
            stream: toUIMessageStream(stream),
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'Graph execution failed';
        console.error('[chat/v2]', error);
        return Response.json({ error: message }, { status: 500 });
    }
}
