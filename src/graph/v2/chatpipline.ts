import {
    StateGraph,
    START,
    END,
    GraphNode,
    StateSchema,
    MessagesValue,
    interrupt,
    getConfig,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { tool } from '@langchain/core/tools';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import type {
    ToolApprovalDecision,
    ToolApprovalInterruptPayload,
    HitlConfigurable,
} from '@/lib/hitl';
import {
    TOOL_DENIAL_PREFIX,
    isToolDenialContent,
} from '@/lib/hitl';
import z from 'zod';
import { ChatOllama } from '@langchain/ollama';
import { MemorySaver } from '@langchain/langgraph';

import { Firecrawl } from 'firecrawl';

const SEARCH_LIMIT = 5;
const SNIPPET_MAX = 280;
const EXCERPT_MAX = 1800;

const firecrawl = new Firecrawl({
    apiKey: process.env.FIRECRAWL_API_KEY ?? '',
});

/**
 * In-process checkpoint store — required for `interrupt()` + `Command({ resume })`.
 * Replace with Postgres/SQLite checkpointer before multi-instance or serverless deploy.
 * @see https://docs.langchain.com/oss/javascript/langgraph/checkpointers
 */
const checkpointer = new MemorySaver();

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

// Helper functions
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

async function geocodeCity(
    city: string,
): Promise<{ latitude: number; longitude: number } | null> {
    try {
        const response = await fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
        );

        if (!response.ok) {
            return null;
        }

        const data = await response.json();

        if (!data.results || data.results.length === 0) {
            return null;
        }

        const [result] = data.results;
        return {
            latitude: result.latitude,
            longitude: result.longitude,
        };
    } catch {
        return null;
    }
}

const getWeatherForLocation = async (latitude: number, longitude: number) => {
    const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`,
    );
    const data = await response.json();
    return data;
};

// Tools
const searchTool = tool(
    async ({ query }: { query: string }) => {
        return await firecrawlSearch(query);
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

const getWeather = tool(
    async ({ city, input }: { city?: string; input?: string }) => {
        const place = (city ?? input)?.trim();
        if (!place) {
            return { error: 'City name is required' };
        }
        const location = await geocodeCity(place);
        if (!location) {
            return { error: `City not found: ${place}` };
        }
        const weather = await getWeatherForLocation(
            location.latitude,
            location.longitude,
        );
        return weather;
    },
    {
        name: 'get_weather',
        description: 'Get current weather for a city',
        schema: z.object({
            city: z.string().optional().describe('City name, e.g. Ajmer'),
            input: z
                .string()
                .optional()
                .describe('City name if the model uses a single input field'),
        }),
    },
);

/** All tools available to the agent (human approval is NOT an LLM tool). */
const ALL_AGENT_TOOLS = [searchTool, getWeather];

function readHitlConfig(): HitlConfigurable {
    const configurable = (getConfig().configurable ?? {}) as HitlConfigurable;
    return configurable;
}

function toolsForRun(config: HitlConfigurable) {
    const enabled = config.enabled_tools;
    if (!enabled?.length) {
        return ALL_AGENT_TOOLS;
    }
    return ALL_AGENT_TOOLS.filter((t) => enabled.includes(t.name));
}

// State schema for the chatbot
const State = new StateSchema({
    messages: MessagesValue,
});

const model = new ChatOllama({
    model: 'glm-5.3:cloud',
    baseUrl: 'https://ollama.com',
    temperature: 0.5,
    headers: {
        Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`,
    },
});

const chatbot: GraphNode<typeof State> = async (state) => {
    const hitl = readHitlConfig();
    const boundTools = toolsForRun(hitl);

    const response = await model
        .bindTools(boundTools)
        .invoke(state.messages, { outputVersion: 'v1' });

    // Append the model message as-is so tool_calls survive for ToolNode routing.
    return { messages: [response] };
};

function routeAfterChatbot(state: typeof State.State) {
    const last = state.messages.at(-1);
    if (AIMessage.isInstance(last) && (last.tool_calls?.length ?? 0) > 0) {
        return 'human_approval';
    }
    return END;
}

/**
 * Pauses the run for human approve/deny when policy requires it.
 * Resume with Command({ resume: ToolApprovalDecision }) from the API.
 */
const humanApproval: GraphNode<typeof State> = async (state) => {
    const hitl = readHitlConfig();
    const last = state.messages.at(-1);
    if (!AIMessage.isInstance(last) || !last.tool_calls?.length) {
        return {};
    }

    const toolCalls = last.tool_calls;
    const autoApprove = new Set(hitl.auto_approve_tools ?? []);
    const needsInterrupt =
        hitl.require_tool_approval === true &&
        toolCalls.some((tc) => !autoApprove.has(tc.name));

    // Auto-run: no interrupt; routing continues to tool_call.
    if (!needsInterrupt) {
        return {};
    }

    // First visit: interrupt with pending tool metadata for the UI.
    // Second visit (after Command resume): `decision` is the user's choice.
    const decision = interrupt<
        ToolApprovalInterruptPayload,
        ToolApprovalDecision
    >({
        kind: 'tool_approval',
        toolCalls: toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            args: tc.args as Record<string, unknown>,
        })),
    });

    if (decision.action === 'deny') {
        const reason =
            decision.reason?.trim() || 'User denied tool execution.';
        const denialMessages = toolCalls.map(
            (tc) =>
                new ToolMessage({
                    content: `${TOOL_DENIAL_PREFIX} ${reason}`,
                    tool_call_id: tc.id ?? '',
                    name: tc.name,
                }),
        );
        return { messages: denialMessages };
    }

    // Approved: proceed to ToolNode with unchanged AI tool_calls in state.
    return {};
};

function routeAfterHumanApproval(state: typeof State.State) {
    const last = state.messages.at(-1);
    if (ToolMessage.isInstance(last) && isToolDenialContent(last.content)) {
        return 'chatbot';
    }
    return 'tool_call';
}

const toolNode = new ToolNode(ALL_AGENT_TOOLS);

/**
 * Graph flow (human-in-the-loop):
 *   START → chatbot → (tool calls?) → human_approval → tool_call → chatbot → END
 *
 * - `human_approval` calls interrupt() when require_tool_approval is true and the
 *   tool is not listed in auto_approve_tools (from config.configurable).
 * - Resume with Command({ resume: { action: 'approve' | 'deny' } }) via POST /api/chat/v2.
 * - Deny injects ToolMessages so the model can respond without running ToolNode.
 */
export const graph = new StateGraph(State)
    .addNode('chatbot', chatbot)
    .addNode('human_approval', humanApproval)
    .addNode('tool_call', toolNode)
    .addEdge(START, 'chatbot')
    .addConditionalEdges('chatbot', routeAfterChatbot, [
        'human_approval',
        END,
    ])
    .addConditionalEdges('human_approval', routeAfterHumanApproval, [
        'tool_call',
        'chatbot',
    ])
    .addEdge('tool_call', 'chatbot')
    .compile({ checkpointer });

export type ChatPipeline = typeof graph;
