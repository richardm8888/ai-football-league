import Anthropic from '@anthropic-ai/sdk';
import { coachProposalSchema } from '@/domain/schemas';
import { env } from '@/lib/env';
import { buildContextPrompt, COACH_SYSTEM_PROMPT, PROPOSE_PLAN_TOOL } from '../prompt';
import {
  AiProviderError, withRetries,
  type AiProvider, type CoachRequest, type CoachResult, type CoachUsage,
} from '../provider';
import { clean, dataBlock } from '../sanitize';

/**
 * The static prefix of every coaching request, marked for caching.
 *
 * The system prompt and the tool schema are the only part of a request that
 * never varies, and they are re-sent in full on every instruction. Caching
 * reprices them at a tenth, and because the prefix says nothing about any
 * particular club — a deliberate fairness property — it is the same bytes for
 * the whole league, so any manager's request warms the cache for all of them.
 * Around a deadline, when the match will not play until everyone has locked in,
 * managers cluster in the same evening and the hit rate should be good.
 *
 * Five minutes, not an hour. A write costs 1.25x input and the hourly TTL
 * doubles that, which needs three reads to repay rather than two, and traffic
 * this sparse will not reliably get them. A manager sending two instructions an
 * hour apart pays the write twice and reads neither; that is a fifth of a cent,
 * and cheaper than the hourly write would be.
 *
 * Two breakpoints rather than one. Requests render as tools, then system, then
 * messages, so the breakpoint on the system prompt already covers both. The
 * second one, at the end of the tool schema, means editing the system prompt —
 * which happens on a deploy, not per request — does not also throw away the
 * larger tool schema entry.
 *
 * There is no error if this stops working: a broken prefix, or a prefix shorter
 * than the model's minimum cacheable length, is billed silently at full price.
 * The prefix is comfortably over the minimum on the default model, but not on
 * every model a league could be pointed at, so the cache counters on AiDecision
 * are the only way this gets noticed.
 */
const CACHE_BREAKPOINT: Anthropic.CacheControlEphemeral = { type: 'ephemeral', ttl: '5m' };

const CACHED_TOOL: Anthropic.Tool = {
  ...(PROPOSE_PLAN_TOOL as unknown as Anthropic.Tool),
  cache_control: CACHE_BREAKPOINT,
};

const CACHED_SYSTEM: Anthropic.TextBlockParam[] = [
  { type: 'text', text: COACH_SYSTEM_PROMPT, cache_control: CACHE_BREAKPOINT },
];

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
            system: CACHED_SYSTEM,
            tools: [CACHED_TOOL],
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
      usage: toUsage(response.usage),
      fallbackUsed: false,
      warnings,
    };
  }
}

/**
 * What the request actually cost, recorded so the cost of running a league is a
 * measurement rather than an estimate. The cache counters are the only way to
 * tell whether caching is working: a broken prefix does not raise an error, it
 * just quietly bills everything at full price.
 *
 * The cache fields are null when the request used no caching at all, which is
 * not the same as a cache miss, but both are zero tokens for costing purposes.
 */
function toUsage(usage: Anthropic.Usage): CoachUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  };
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
