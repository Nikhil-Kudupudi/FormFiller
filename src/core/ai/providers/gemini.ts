import { SYSTEM_PROMPT, buildResponseSchema, buildUserMessage } from '../guard';
import {
  failureFromError,
  failureFromStatus,
  type CompletionRequest,
  type CompletionResult,
  type LlmAdapter,
  type ProviderConfig,
} from '../types';

const ORIGIN = 'https://generativelanguage.googleapis.com';

/**
 * Google Gemini.
 *
 * Uses `generateContent` rather than the newer Interactions API, for a privacy
 * reason as much as a stability one: `generateContent` is stateless, so there
 * is no server-side retention default to opt out of. Interactions persist by
 * default and would need `store: false` set correctly on every call -- an easy
 * thing to get wrong in a tool that handles resumes and home addresses.
 *
 * Gemini's `responseSchema` is an OpenAPI subset that rejects
 * `additionalProperties`, so the shared schema is adapted below rather than
 * sent as-is.
 */

/** Strip keys Gemini's schema dialect rejects. */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (typeof schema !== 'object' || schema === null) return schema;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === 'additionalProperties') continue;
    out[key] = toGeminiSchema(value);
  }
  return out;
}

export const geminiAdapter: LlmAdapter = {
  id: 'gemini',
  label: 'Google Gemini',
  origin: ORIGIN,
  defaultModel: 'gemini-2.0-flash',
  suggestedModels: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],

  async complete(
    request: CompletionRequest,
    apiKey: string,
    config: ProviderConfig,
  ): Promise<CompletionResult> {
    const base = config.baseUrl ?? ORIGIN;
    const url = `${base}/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        signal: request.signal,
        headers: {
          'content-type': 'application/json',
          // In a header, never a query parameter: a URL carrying the key would
          // be visible in logs and proxies.
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [
            {
              role: 'user',
              parts: [
                { text: buildUserMessage(request.fields, request.allowedKeys) },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(buildResponseSchema(request.allowedKeys)),
            maxOutputTokens: 4096,
          },
        }),
      });
    } catch (error) {
      return { ok: false, ...failureFromError(error) };
    }

    if (!response.ok) return { ok: false, ...failureFromStatus(response.status) };

    const body = (await response.json()) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        finishReason?: string;
      }[];
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
    };

    // A blocked prompt returns 200 with no candidates, so this has to be
    // checked explicitly rather than inferred from an empty response.
    if (body.promptFeedback?.blockReason) {
      return { ok: false, reason: 'refusal', message: 'The model declined this request.' };
    }

    const candidate = body.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') {
      return { ok: false, reason: 'truncated', message: 'The response was cut short.' };
    }
    if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'RECITATION') {
      return { ok: false, reason: 'refusal', message: 'The model declined this request.' };
    }

    const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return {
      ok: true,
      text,
      ...(body.usageMetadata
        ? {
            usage: {
              input: body.usageMetadata.promptTokenCount,
              output: body.usageMetadata.candidatesTokenCount,
            },
          }
        : {}),
    };
  },
};
