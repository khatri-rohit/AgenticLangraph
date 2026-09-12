import model from '@/lib/model';
import {
    StateGraph,
    StateSchema,
    START,
    END,
    MessagesValue,
    GraphNode,
} from '@langchain/langgraph';

const State = new StateSchema({
    messages: MessagesValue,
});

const chatbot: GraphNode<typeof State> = async (state) => {
    const response = await model.invoke(state.messages);
    return {
        messages: [
            ...state.messages,
            { role: 'ai', content: response.content },
        ],
    };
};

const graph = new StateGraph(State)
    .addNode('chatbot', chatbot)
    .addEdge(START, 'chatbot')
    .addEdge('chatbot', END);

graph.compile();
