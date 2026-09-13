import { toBaseMessages, toUIMessageStream } from '@ai-sdk/langchain';
import { createUIMessageStreamResponse, type UIMessage } from 'ai';
import { graph } from '@/graph/v2/chatpipline';

export const maxDuration = 60;

export async function POST(req: Request) {
    const { messages, threadId }: { messages: UIMessage[]; threadId?: string } =
        await req.json();

    const langchainMessages = await toBaseMessages(messages);

    const stream = await graph.stream(
        { messages: langchainMessages },
        {
            streamMode: ['values', 'messages', 'updates'],
            configurable: { thread_id: threadId ?? 'default' },
        },
    );

    return createUIMessageStreamResponse({
        stream: toUIMessageStream(stream),
    });
}
