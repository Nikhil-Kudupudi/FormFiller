import { SYSTEM_PROMPT, buildResponseSchema, buildUserMessage } from '../guard';
import {
  failureFromError,
  failureFromStatus,
  type CompletionRequest,
  type CompletionResult,
  type LlmAdapter,
  type ProviderConfig,
  type ProviderId,
} from '../types';

/**
 * One implementation for OpenAI and xAI Grok.
 *
 * Grok is wire-compatible with OpenAI's chat-completions shape, so the only
 * things that differ are the origin, the default model, and the label. Writing
 * these as two hand-maintained adapters would mean fixing every bug twice.
 *
 * One xAI quirk worth knowing: its schema validation defaults
 * `additionalProperties` to false, which our schema sets explicitly anyway.
 */
interface OpenAiCompatibleOptions {
  id: ProviderId;
  label: string;
  origin: string;
  defaultModel: string;
  suggestedModels: readonly string[];
}

export function makeOpenAiCompatibleAdapter(
  options: OpenAiCompatibleOptions,
): LlmAdapter {
  return {
    id: options.id,
    label: options.label,
    origin: options.origin,
    defaultModel: options.defaultModel,
    suggestedModels: options.suggestedModels,

    async complete(
      request: CompletionRequest,
      apiKey: string,
      config: ProviderConfig,
    ): Promise<CompletionResult> {
      const base = config.baseUrl ?? options.origin;

      let response: Response;
      try {
        response = await fetch(`${base}/v1/chat/completions`, {
          method: 'POST',
          signal: request.signal,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              {
                role: 'user',
                content: buildUserMessage(request.fields, request.allowedKeys),
              },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'field_mapping',
                // strict is what turns this from "valid JSON" into "valid
                // against this schema". Without it the enum is advisory.
                strict: true,
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
        choices?: {
          message?: { content?: string; refusal?: string | null };
          finish_reason?: string;
        }[];
        usage?: { prompt_tokens: number; completion_tokens: number };
      };

      const choice = body.choices?.[0];

      // A refusal comes back as its own field rather than as an error status,
      // and its content will not match the schema.
      if (choice?.message?.refusal) {
        return { ok: false, reason: 'refusal', message: 'The model declined this request.' };
      }
      if (choice?.finish_reason === 'length') {
        return { ok: false, reason: 'truncated', message: 'The response was cut short.' };
      }

      return {
        ok: true,
        text: choice?.message?.content ?? '',
        ...(body.usage
          ? {
              usage: {
                input: body.usage.prompt_tokens,
                output: body.usage.completion_tokens,
              },
            }
          : {}),
      };
    },
  };
}

export const openaiAdapter = makeOpenAiCompatibleAdapter({
  id: 'openai',
  label: 'OpenAI',
  origin: 'https://api.openai.com',
  defaultModel: 'gpt-4o-mini',
  suggestedModels: ['gpt-4o-mini', 'gpt-4o'],
});

export const xaiAdapter = makeOpenAiCompatibleAdapter({
  id: 'xai',
  label: 'xAI Grok',
  origin: 'https://api.x.ai',
  defaultModel: 'grok-2-latest',
  suggestedModels: ['grok-2-latest'],
});
