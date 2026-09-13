import { toBaseMessages, toUIMessageStream } from '@ai-sdk/langchain';
import { createUIMessageStreamResponse, type UIMessage } from 'ai';
import { graph } from '@/graph/v2/chatpipline';
import { Command } from '@langchain/langgraph';

export const maxDuration = 60;
type ToolApprovalDecision =
    | { action: 'approve' }
    | { action: 'deny'; reason?: string };
export async function POST(req: Request) {
    const {
        messages,
        threadId,
        approval,
        requireToolApproval,
        enabledTools,
        autoApproveTools,
    }: {
        messages: UIMessage[];
        threadId?: string;
        approval?: ToolApprovalDecision; // only on resume
        requireToolApproval?: boolean;
        enabledTools?: string[];
        autoApproveTools?: string[];
    } = await req.json();

    const langchainMessages = await toBaseMessages(messages);

    const stream = requireToolApproval
        ? await graph.streamEvents(
              new Command({ resume: requireToolApproval }),
              {
                  version: 'v2',
                  configurable: { thread_id: threadId ?? 'default' },
                  streamMode: ['values', 'messages', 'updates'],
              },
          )
        : await graph.streamEvents(
              { messages: langchainMessages },
              {
                  version: 'v2',
                  configurable: { thread_id: threadId ?? 'default' },
                  streamMode: ['values', 'messages', 'updates'],
              },
          );

    return createUIMessageStreamResponse({
        stream: toUIMessageStream(stream),
    });
}
