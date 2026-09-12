import {
    StateGraph,
    START,
    END,
    GraphNode,
    Annotation,
    StateSchema,
    MessagesValue,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { tool } from '@langchain/core/tools';
import { AIMessage } from '@langchain/core/messages';
import { type BaseMessage } from '@langchain/core/messages';
import z from 'zod';
import { ChatOllama } from '@langchain/ollama';
import { Firecrawl } from 'firecrawl';

const SEARCH_LIMIT = 5;
const SNIPPET_MAX = 280;
const EXCERPT_MAX = 1800;

const firecrawl = new Firecrawl({
    apiKey: process.env.FIRECRAWL_API_KEY ?? '',
});

export type WebSearchHit = {
    title: string;
    url: string;
    snippet: string;
    excerpt?: string;
};

export type WebSearchOutput = {
    query: string;
    results: WebSearchHit[];
    error?: string;
};

export type FetchedPage = {
    url: string;
    title?: string;
    markdown?: string;
    error?: string;
};

export type FetchUrlOutput = {
    pages: FetchedPage[];
    error?: string;
};

// const AnnotationWithReducer = Annotation.Root({
//     messages: Annotation<BaseMessage[]>({
//         // Different types are allowed for updates
//         reducer: (left: BaseMessage[], right: BaseMessage | BaseMessage[]) => {
//             if (Array.isArray(right)) {
//                 return left.concat(right);
//             }
//             return left.concat([right]);
//         },
//         default: () => [],
//     }),
// });

export async function firecrawlSearch(
    query: string,
    options?: { scrape?: boolean },
): Promise<WebSearchOutput> {
    const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
    if (!apiKey) {
        return {
            query,
            results: [],
            error: 'Search is not configured. FIRECRAWL_API_KEY is missing.',
        };
    }

    try {
        const data = await firecrawl.search(query, {
            limit: SEARCH_LIMIT,
            ...(options?.scrape
                ? { scrapeOptions: { formats: ['markdown' as const] } }
                : {}),
        });
        const results = (data.web ?? [])
            .map(normalizeHit)
            .filter((hit): hit is WebSearchHit => hit != null);

        if (results.length === 0) {
            return {
                query,
                results: [],
                error: 'No web results for that query. Try a more specific search.',
            };
        }

        return { query, results };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            query,
            results: [],
            error: `Search failed: ${message}`,
        };
    }
}

export const searchTool = tool(
    async ({ query }: { query: string }) => {
        const results = await firecrawlSearch(query);
        console.log('searchTool results', results);
        return results;
    },
    {
        name: 'firecrawl_search',
        description:
            'You must use this tool to search the web for information which u dont have and talk with real facts rather than hallucinating',
        schema: z.object({
            query: z.string().describe('The query to search for'),
        }),
    },
);

function normalizeHit(item: unknown): WebSearchHit | null {
    if (!item || typeof item !== 'object') return null;

    const rec = item as Record<string, unknown>;
    const metadata =
        rec.metadata && typeof rec.metadata === 'object'
            ? (rec.metadata as Record<string, unknown>)
            : {};

    const url = firstString(
        rec.url,
        metadata.sourceURL,
        metadata.url,
        metadata.ogUrl,
    );
    if (!url) return null;

    const title =
        firstString(rec.title, metadata.title, metadata.ogTitle) || url;
    const snippet = firstString(
        rec.description,
        rec.snippet,
        rec.summary,
        metadata.description,
        metadata.ogDescription,
    );
    const markdown =
        typeof rec.markdown === 'string' ? rec.markdown.trim() : '';

    return {
        title,
        url,
        snippet: clip(snippet || markdown, SNIPPET_MAX),
        ...(markdown ? { excerpt: clip(markdown, EXCERPT_MAX) } : {}),
    };
}
function firstString(...values: unknown[]): string {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

function clip(text: string, max: number): string {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= max) return compact;
    return `${compact.slice(0, max)}…`;
}

// State schema for the chatbot
const State = new StateSchema({
    messages: MessagesValue,
});

const chatbot: GraphNode<typeof State> = async (state) => {
    const model = new ChatOllama({
        model: 'glm-5.2:cloud',
        baseUrl: 'https://ollama.com',
        temperature: 0.7,
        headers: {
            Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`,
        },
    });
    // Bind tools so the model can decide to call firecrawl_search.
    const response = await model.bindTools([searchTool]).invoke(state.messages);
    console.log('response', response);
    return {
        messages: [...state.messages, new AIMessage(response.content)],
    };
};

// Route to tool_call if the latest AI message has tool calls, else finish.
function routeTools(state: typeof State.State) {
    const last = state.messages[state.messages.length - 1];
    if (
        'tool_calls' in last &&
        Array.isArray((last as { tool_calls?: unknown }).tool_calls) &&
        (last as { tool_calls: unknown[] }).tool_calls.length > 0
    ) {
        return 'tool_call';
    }
    return END;
}

export const graph = new StateGraph(State)
    .addNode('chatbot', chatbot)
    .addNode('tool_call', new ToolNode([searchTool]))
    .addEdge(START, 'chatbot')
    .addConditionalEdges('chatbot', routeTools)
    .addEdge('tool_call', END)
    .compile();

export type ChatPipeline = typeof graph;
