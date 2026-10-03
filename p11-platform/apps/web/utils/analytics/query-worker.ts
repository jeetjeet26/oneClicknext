import { createHash, randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { queryRaw } from './query-store';
import { queryPlan, planFits } from './query-contracts';
import type { BiFilters } from './report-contracts';
export const queryAssistantEnabled = () => process.env.BI_QUERY_ASSISTANT_ENABLED === 'true' && !!process.env.OPENAI_API_KEY;
type Completion = {
    raw: string;
    providerId: string | null;
    model: string;
    usage: unknown;
};
type Dependencies = {
    enabled: boolean;
    rpc: typeof queryRaw;
    interpret: (question: string, filters: BiFilters) => Promise<Completion>;
};
async function interpret(question: string, filters: BiFilters): Promise<Completion> {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 20000 });
    const response = await client.chat.completions.create({ model: 'gpt-4o-mini', temperature: 0.1, max_tokens: 500, messages: [{ role: 'system', content: `Translate this marketing question into a bounded plan, never SQL. All calculations use a previously saved report covering ${filters.startDate} through ${filters.endDate}, channel ${filters.channel || 'all stored channels'}, account ${filters.account || 'all stored accounts'}. Only narrow that scope. Return exactly {"groupBy":"none|day|week|month|channel|campaign","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","channel":null}. Channel may instead be an exact canonical channel (google_ads, meta_ads, ga4, tiktok_ads, linkedin_ads, bing_ads) within the saved scope. Default to all saved dates and channels. Supported figures: impressions, clicks, spend, provider-attributed conversions, CTR, CPC and CPA. Return {"unsupported":true} for rankings, comparisons, forecasts, causal claims, leases, deduplicated people or custom calculations. Results are ordered by grouping identity, not performance. Do not return property IDs, code, extra fields, explanations or invented figures.` }, { role: 'user', content: question }] });
    return { raw: response.choices[0]?.message.content || '', providerId: response.id || null, model: response.model, usage: response.usage ? { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens, totalTokens: response.usage.total_tokens } : null };
}
export async function interpretBiQuery(id: string, deps: Dependencies = { enabled: queryAssistantEnabled(), rpc: queryRaw, interpret }) {
    if (!deps.enabled)
        return { started: false, reason: 'disabled' };
    const token = randomUUID(), claim = await deps.rpc('claim_bi_query', { p_id: id, p_claim_token: token });
    if (claim.state !== 'started')
        return { started: false, reason: String(claim.state) };
    let receipt: Record<string, unknown>;
    try {
        const completion = await deps.interpret(String(claim.question), claim.filters as BiFilters);
        const rawBytes = new TextEncoder().encode(completion.raw).length;
        let proposed: unknown;
        try {
            proposed = JSON.parse(completion.raw);
        }
        catch { }
        const parsed = queryPlan.safeParse(proposed), valid = parsed.success && planFits(parsed.data, claim.filters as BiFilters);
        const unsupported = !!proposed && typeof proposed === 'object' && 'unsupported' in proposed && proposed.unsupported === true;
        receipt = { raw: rawBytes <= 16000 ? completion.raw : null, rawSha256: createHash('sha256').update(completion.raw).digest('hex'), rawOmitted: rawBytes > 16000, providerId: completion.providerId, model: completion.model, usage: completion.usage, plan: valid ? parsed.data : null, issue: valid ? null : unsupported ? 'unsupported' : 'invalid_reply' };
    }
    catch {
        receipt = { raw: null, providerId: null, model: 'gpt-4o-mini', usage: null, plan: null, issue: 'provider_unknown' };
    }
    // A missing acknowledgement never authorizes another model call. Recovery reads retained state.
    const result = await deps.rpc('prepare_bi_query', { p_id: id, p_claim_token: token, p_receipt: receipt });
    if (!['saved', 'replayed'].includes(String(result.state)))
        throw new Error('Query interpretation history could not be confirmed.');
    return { started: true, status: String(result.status) };
}
