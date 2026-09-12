import { tool } from '@langchain/core/tools';
import { firecrawlSearch } from './firecrawl';
import z from 'zod';

export const searchTool = tool(
    async ({ query }: { query: string }) => {
        const results = await firecrawlSearch(query);
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
