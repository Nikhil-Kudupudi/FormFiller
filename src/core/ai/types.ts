import type { FieldKey } from '@/core/profile/keys';

/**
 * The provider-agnostic contract.
 *
 * All four providers are reached over raw `fetch` rather than their official
 * SDKs. In an MV3 service worker the Anthropic SDK needs
 * `dangerouslyAllowBrowser`, each SDK adds bundle weight to an extension that
 * is already injected into every matching page, and mixing one SDK with three
 * hand-written clients would make the adapters structurally inconsistent. One
 * uniform HTTP shape across all four is the right trade here.
 *
 * An adapter's job ends at "the model replied with this text". It does not
 * parse, validate, or interpret -- that is the guard's job, and only the
 * orchestrator holds the live DOM needed to re-check an answer.
 */

export type ProviderId = 'gemini' | 'openai' | 'xai' | 'anthropic';

/**
 * What the model is asked to classify.
 *
 * It sees an opaque id and the *shape* of the field. It never sees a profile
 * value, and it never returns a selector -- only one of these ids paired with
 * a key from a closed set.
 */
export interface SkeletonField {
  /** Opaque, scan-local. Meaningless to anyone who intercepts the payload. */
  id: string;
  tag: string;
  type: string;
  label: string;
  /** Attribute names and values that carry field semantics, never user input. */
  attributes: string[];
  /** Option labels for a select, so the model can tell a country from a state. */
  options?: string[];
}

export interface CompletionRequest {
  fields: SkeletonField[];
  /** The keys the model may choose from. Not the values behind them. */
  allowedKeys: readonly FieldKey[];
  signal: AbortSignal;
}

export interface Mapping {
  fieldId: string;
  key: FieldKey;
  confidence: number;
}

export type LlmFailure =
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'timeout'
  | 'refusal'
  | 'truncated'
  | 'schema_rejected'
  | 'invalid_response';

export interface Usage {
  input: number;
  output: number;
}

/** What an adapter returns: the model's text, or why there isn't any. */
export type CompletionResult =
  | { ok: true; text: string; usage?: Usage }
  | { ok: false; reason: LlmFailure; message: string };

/** What the orchestrator returns, after guarding. */
export type ClassifyOutcome =
  | { ok: true; mappings: Mapping[]; rejected: RejectedMapping[]; usage?: Usage }
  | { ok: false; reason: LlmFailure; message: string };

export interface RejectedMapping {
  fieldId: string;
  key: string;
  reason: string;
}

export interface ProviderConfig {
  model: string;
  /**
   * Overriding the endpoint is possible but only from the options page. It is
   * never taken from page content or from a model response -- that would let a
   * hostile page redirect the user's API key to a host of its choosing.
   */
  baseUrl?: string;
}

export interface LlmAdapter {
  readonly id: ProviderId;
  readonly label: string;
  /** For `permissions.contains()` before each call, which Firefox needs. */
  readonly origin: string;
  readonly defaultModel: string;
  /** Models worth offering in the options page, cheapest first. */
  readonly suggestedModels: readonly string[];
  complete(
    request: CompletionRequest,
    apiKey: string,
    config: ProviderConfig,
  ): Promise<CompletionResult>;
}

/** Normalise a thrown fetch error into a reason the UI can act on. */
export function failureFromError(error: unknown): { reason: LlmFailure; message: string } {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { reason: 'timeout', message: 'The request took too long and was cancelled.' };
  }
  return {
    reason: 'network',
    message: 'Could not reach the provider. Check your connection.',
  };
}

/**
 * Map an HTTP status onto a reason, with a message safe to show the user.
 *
 * The message never echoes the response body: a provider error can contain
 * the request, and the request carries the API key in a header.
 */
export function failureFromStatus(status: number): { reason: LlmFailure; message: string } {
  if (status === 401 || status === 403) {
    return { reason: 'auth', message: 'The API key was rejected. Check it in Options.' };
  }
  if (status === 404) {
    return { reason: 'schema_rejected', message: 'Unknown model. Check it in Options.' };
  }
  if (status === 429) {
    return { reason: 'rate_limit', message: 'Rate limited by the provider.' };
  }
  if (status === 400) {
    return { reason: 'schema_rejected', message: 'The provider rejected the request shape.' };
  }
  return { reason: 'network', message: `Provider returned HTTP ${status}.` };
}
