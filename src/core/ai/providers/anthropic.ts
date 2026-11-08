import { SYSTEM_PROMPT, buildResponseSchema, buildUserMessage } from '../guard';
import {
  failureFromError,
  failureFromStatus,
  type CompletionRequest,
  type CompletionResult,
  type LlmAdapter,
  type ProviderConfig,
} from '../types';

const ORIGIN = 'https://api.anthropic.com';

/**
 * Anthropic Messages API.
 *
 * Two details differ from the OpenAI-shaped adapters and are easy to get wrong
 * by porting code across:
 *
 *   - Structured output lives in `output_config.format`. The older
 *     `output_format` key is deprecated and now needs a beta header.
 *   - There is no `strict` flag for JSON output. `strict: true` exists but
 *     applies to *tool* definitions, which is a separate feature.
 */
export const anthropicAdapter: LlmAdapter = {
  id: 'anthropic',
  label: 'Anthropic Claude',
  origin: ORIGIN,
  defaultModel: 'claude-opus-5-5',
  suggestedModels: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],

  async complete(
    request: CompletionRequest,
    apiKey: string,
    config: ProviderConfig,
  ): Promise<CompletionResult> {
    const base = config.baseUrl ?? ORIGIN;

    let response: Response;
    try {
      response = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        signal: request.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [
            { role: 'user', content: buildUserMessage(request.fields, request.allowedKeys) },
          ],
          output_config: {
            format: {
              type: 'json_schema',
              schema: buildResponseSchema(request.allowedKeys),
            },
          },
        }),
      });
    } catch (error) {
      return { ok: false, ...failureFromError(error) };
    }

    if (!response.ok) return { ok: false, ...failureFromStatus(response.status) };

    const body = (await response.json()) as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
      usage?: { input_tokens: number; output_tokens: number };
    };

    // Check the stop reason before parsing. A refusal and a truncation both
    // produce output that fails the schema, and parsing first would report
    // "invalid response" for what is really a refusal or a token limit.
    if (body.stop_reason === 'refusal') {
      return { ok: false, reason: 'refusal', message: 'The model declined this request.' };
    }
    if (body.stop_reason === 'max_tokens') {
      return { ok: false, reason: 'truncated', message: 'The response was cut short.' };
    }

    const text = body.content?.find((b) => b.type === 'text')?.text ?? '';
    return {
      ok: true,
      text,
      ...(body.usage
        ? { usage: { input: body.usage.input_tokens, output: body.usage.output_tokens } }
        : {}),
    };
  },
};
