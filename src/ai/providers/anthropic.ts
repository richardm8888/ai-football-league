import Anthropic from '@anthropic-ai/sdk';
import { coachProposalSchema } from '@/domain/schemas';
import { env } from '@/lib/env';
import { buildContextPrompt, COACH_SYSTEM_PROMPT, PROPOSE_PLAN_TOOL } from '../prompt';
import {
  AiProviderError, withRetries, type AiProvider, type CoachRequest, type CoachResult,
} from '../provider';
import { clean, dataBlock } from '../sanitize';

/**
 * The Anthropic provider.
 *
 * The model is constrained to a single tool, so the only thing it can produce is
 * a typed proposal. Timeouts, retries and rate limits are handled here; the
 * caller decides what to do if this provider gives up.
 */
export class AnthropicCoachProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;

  constructor(apiKey: string, model = env.ai.model) {
    this.model = model;
    this.client = new Anthropic({ apiKey, maxRetries: 0 });
  }

  async propose(request: CoachRequest): Promise<CoachResult> {
    const started = Date.now();
    const warnings: string[] = [];

    const memoryBlock = request.memories.length > 0
      ? dataBlock('staff_notes_from_previous_weeks',
        request.memories.map((m) => `- ${clean(m.key, 60)}: ${clean(m.content, 400)}`).join('\n'))
      : '';

    const userContent = [
      buildContextPrompt(request.context),
      memoryBlock,
      dataBlock('manager_message', clean(request.message, 4000)),
      'Respond by calling propose_plan.',
    ].filter(Boolean).join('\n\n');

    const messages: Anthropic.MessageParam[] = [
      ...request.history.slice(-8).map((turn) => ({
        role: turn.role === 'USER' ? ('user' as const) : ('assistant' as const),
        content: clean(turn.content, 2000) || '(empty)',
      })),
      { role: 'user', content: userContent },
    ];

    const response = await withRetries(
      async (_attempt, signal) => {
        try {
          return await this.client.messages.create({
            model: this.model,
            max_tokens: 3000,
            system: COACH_SYSTEM_PROMPT,
            tools: [PROPOSE_PLAN_TOOL as unknown as Anthropic.Tool],
            tool_choice: { type: 'tool', name: PROPOSE_PLAN_TOOL.name },
            messages,
          }, { signal });
        } catch (error) {
          throw toProviderError(error);
        }
      },
      {
        retries: env.ai.maxRetries,
        timeoutMs: env.ai.timeoutMs,
        onRetry: (attempt) => warnings.push(`Retried the coaching staff request (attempt ${attempt}).`),
      },
    );

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
    if (!toolUse) {
      throw new AiProviderError('The coaching staff replied without a structured proposal.', false);
    }

    const parsed = coachProposalSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new AiProviderError(
        `The proposal did not match the expected shape: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
        false, parsed.error);
    }

    return {
      proposal: parsed.data,
      provider: this.name,
      model: this.model,
      latencyMs: Date.now() - started,
      fallbackUsed: false,
      warnings,
    };
  }
}

function toProviderError(error: unknown): AiProviderError {
  // Nothing else aborts this request, so an abort means the deadline passed.
  // The timeout is already on its way to the caller as a retryable error;
  // matching it here keeps the fallback behaviour the same whichever arrives first.
  if (error instanceof Anthropic.APIUserAbortError) {
    return new AiProviderError('The coaching staff did not answer in time.', true, error);
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    // Rate limits, overloads and server faults are worth another attempt.
    const retryable = status === 429 || status === 408 || status >= 500;
    const message = status === 429
      ? 'The coaching staff are rate limited. Try again shortly.'
      : status === 401 || status === 403
        ? 'The AI provider rejected the credentials for this installation.'
        : `The AI provider returned an error (${status || 'network'}).`;
    return new AiProviderError(message, retryable, error);
  }
  if (error instanceof AiProviderError) return error;
  return new AiProviderError('Could not reach the AI provider.', true, error);
}
