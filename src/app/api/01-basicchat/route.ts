import { NextRequest, NextResponse } from 'next/server';
import { AIMessage } from '@langchain/core/messages';
import { graph } from '@/graph/chatpipline';

async function handler(req: NextRequest) {
    const { messages } = await req.json();
    console.log('messages', messages);
    const response = await graph.invoke({
        messages: [new AIMessage({ content: messages })],
    });
    console.log('response', response);
    return NextResponse.json(response);
}

export { handler as GET, handler as POST };
