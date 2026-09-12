import { ChatOllama } from '@langchain/ollama';

const model = new ChatOllama({
    model: 'glm:5.2-cloud',
    baseUrl: 'https://ollama.com',
    temperature: 0.7,
    headers: {
        Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`,
    },
});

export default model;
