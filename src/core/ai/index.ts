import { FIELD_KEYS } from '@/core/profile/keys';
import type { FieldCandidate } from '@/core/detect/collect';
import { guardResponse } from './guard';
import { anthropicAdapter } from './providers/anthropic';
import { geminiAdapter } from './providers/gemini';
import { openaiAdapter, xaiAdapter } from './providers/openai-compatible';
import { MAX_FIELDS_PER_REQUEST, assertNoProfileValues, buildSkeleton } from './skeleton';
import type {
  ClassifyOutcome,
  LlmAdapter,
  ProviderConfig,
  ProviderId,
  SkeletonField,
} from './types';

export const ADAPTERS: Record<ProviderId, LlmAdapter> = {
  gemini: geminiAdapter,
  xai: xaiAdapter,
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
};

/**
 * Allow-listed origins.
 *
 * A base URL is only ever honoured if it matches one of these. The point is
 * that nothing read from a page, a job posting, or a model response can
 * redirect a request -- and a request carries the user's API key.
 */
const ALLOWED_ORIGINS = new Set(Object.values(ADAPTERS).map((a) => a.origin));

export function isAllowedBaseUrl(url: string): boolean {
  try {
    return ALLOWED_ORIGINS.has(new URL(url).origin);
  } catch {
    return false;
  }
}

/** Hard ceiling, so a hung provider cannot leave the panel spinning forever. */
const TIMEOUT_MS = 10_000;

export interface ClassifyParams {
  providerId: ProviderId;
  apiKey: string;
  config: ProviderConfig;
  /** Only fields the heuristics could not place. */
  candidates: FieldCandidate[];
  includeDemographics: boolean;
  /**
   * The user's own profile values, used solely to assert they are absent from
   * the outgoing payload. They are never sent.
   */
  profileValues: string[];
}

/**
 * Classify unmatched fields with a model.
 *
 * The flow is deliberately: build a minimal payload, prove it carries nothing
 * personal, send it, then distrust everything that comes back. The model's
 * answer is a suggestion that has to survive the same checks the heuristics
 * already applied.
 */
export async function classifyWithAi(params: ClassifyParams): Promise<ClassifyOutcome> {
  const adapter = ADAPTERS[params.providerId];

  if (params.config.baseUrl && !isAllowedBaseUrl(params.config.baseUrl)) {
    return {
      ok: false,
      reason: 'network',
      message: 'That endpoint is not an allowed provider origin.',
    };
  }

  const skeleton: SkeletonField[] = buildSkeleton(params.candidates);
  if (skeleton.length === 0) {
    return { ok: true, mappings: [], rejected: [] };
  }

  // Belt and braces: the skeleton builder is an allow-list, so this should be
  // impossible. If it ever fires, the request must not go out.
  assertNoProfileValues(skeleton, params.profileValues);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const result = await adapter.complete(
      { fields: skeleton, allowedKeys: FIELD_KEYS, signal: controller.signal },
      params.apiKey,
      params.config,
    );

    if (!result.ok) return result;

    const byId = new Map(params.candidates.map((c) => [c.id, c]));
    const guarded = guardResponse(result.text, {
      sent: skeleton,
      candidates: byId,
      includeDemographics: params.includeDemographics,
    });

    return {
      ok: true,
      mappings: guarded.mappings,
      rejected: guarded.rejected,
      ...(result.usage ? { usage: result.usage } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}

export { MAX_FIELDS_PER_REQUEST, buildSkeleton };
export type { ProviderId, ProviderConfig } from './types';
