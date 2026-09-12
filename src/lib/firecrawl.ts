import { Firecrawl } from 'firecrawl';

const SNIPPET_MAX = 280;
const EXCERPT_MAX = 1800;
const SEARCH_LIMIT = 5;
const FETCH_URL_MAX = 3;
const PAGE_MAX = 3500;

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

/**
 * Open specific URLs (usually from a prior internet_search hit) and
 * return clipped markdown. Empty input must not fall back to demo sites.
 */
export async function firecrawlFetchUrl(
    urls: string[],
): Promise<FetchUrlOutput> {
    const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
    if (!apiKey) {
        return {
            pages: [],
            error: 'Search is not configured. FIRECRAWL_API_KEY is missing.',
        };
    }

    const unique = [
        ...new Set(urls.map((url) => url.trim()).filter(isHttpUrl)),
    ];
    const limited = unique.slice(0, FETCH_URL_MAX);

    if (limited.length === 0) {
        return {
            pages: [],
            error: 'No valid http(s) URLs to scrape. Use URLs from internet_search, or a URL the user pasted.',
        };
    }

    try {
        const job = await firecrawl.batchScrape(limited, {
            options: { formats: ['markdown'] },
            pollInterval: 2,
            timeout: 120,
        });

        if (job.status === 'failed' || job.status === 'cancelled') {
            return {
                pages: limited.map((url) => ({
                    url,
                    error: `Scrape job ${job.status}.`,
                })),
                error: `Could not scrape those pages (job ${job.status}).`,
            };
        }

        const byUrl = new Map<string, FetchedPage>();
        for (const doc of job.data ?? []) {
            const url = firstString(
                doc.metadata?.sourceURL,
                doc.metadata?.url,
                doc.metadata?.ogUrl,
            );
            const markdown =
                typeof doc.markdown === 'string'
                    ? clip(doc.markdown, PAGE_MAX)
                    : '';
            const title = firstString(
                doc.metadata?.title,
                doc.metadata?.ogTitle,
            );
            const key = url || limited[0];
            byUrl.set(key, {
                url: key,
                ...(title ? { title } : {}),
                ...(markdown
                    ? { markdown }
                    : { error: 'Page had no readable markdown.' }),
            });
        }

        const pages = limited.map((url) => {
            const hit = byUrl.get(url);
            return (
                hit ?? {
                    url,
                    error: 'No scrape result for this URL.',
                }
            );
        });

        if (pages.every((page) => page.error && !page.markdown)) {
            return {
                pages,
                error: 'None of those pages returned readable content.',
            };
        }

        return { pages };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            pages: limited.map((url) => ({ url, error: message })),
            error: `Scrape failed: ${message}`,
        };
    }
}

function isHttpUrl(value: string): boolean {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

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
