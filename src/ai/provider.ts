import type { CoachProposal } from '@/domain/schemas';
import type { CoachContext } from './context';

/**
 * The AI provider abstraction.
 *
 * The application talks to coaching staff through this interface and nothing
 * else, so swapping provider, pinning a model for fairness, or falling back to
 * the local coach are all one-line decisions rather than a rewrite.
 */

export interface CoachTurn {
  role: 'USER' | 'ASSISTANT';
  content: string;
}

export interface CoachRequest {
  /** The manager's instruction, in their own words. */
  message: string;
  history: CoachTurn[];
  context: CoachContext;
  /** Long-lived notes the staff keep about this club. */
  memories: Array<{ key: string; content: string }>;
}

/**
 * What one API call actually cost, as the provider reported it.
 *
 * Absent for providers that make no API call — the local coach, and the local
 * coach standing in after a provider failure — because zero tokens and no
 * measurement are different things and averaging them together would quietly
 * understate the real cost per instruction.
 */
export interface CoachUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens written to the prompt cache, billed at 1.25x input. */
  cacheCreationInputTokens: number;
  /** Tokens served from the prompt cache, billed at a tenth of input. */
  cacheReadInputTokens: number;
}

export interface CoachResult {
  proposal: CoachProposal;
  provider: string;
  model: string;
  latencyMs: number;
  /** Measured token usage, when the provider reported any. */
  usage?: CoachUsage;
  /** True when the primary provider failed and the local coach answered. */
  fallbackUsed: boolean;
  /** Non-fatal problems worth surfacing, such as a retried request. */
  warnings: string[];
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  propose(request: CoachRequest): Promise<CoachResult>;
}

export class AiProviderError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly cause?: unknown) {
    super(message);
  }
}

/**
 * Run an operation with a timeout, bounded retries and backoff.
 *
 * Each attempt is handed its own signal, so an attempt the deadline has already
 * given up on is cancelled rather than left running alongside its replacement.
 */
export async function withRetries<T>(
  operation: (attempt: number, signal: AbortSignal) => Promise<T>,
  options: { retries: number; timeoutMs: number; onRetry?: (attempt: number, error: unknown) => void },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      return await withTimeout((signal) => operation(attempt, signal), options.timeoutMs);
    } catch (error) {
      lastError = error;
      const retryable = !(error instanceof AiProviderError) || error.retryable;
      if (!retryable || attempt === options.retries) break;
      options.onRetry?.(attempt + 1, error);
      // Exponential backoff, capped so a manager is never left waiting long.
      await delay(Math.min(4000, 400 * 2 ** attempt));
    }
  }
  throw lastError;
}

/**
 * Start an operation under a deadline and cancel it when the deadline passes.
 *
 * The operation is started here with a signal rather than passed in already in
 * flight, because giving up on this side does nothing to the work on the other:
 * a generation nobody is waiting for still runs to completion and is still
 * billed, and marking the timeout retryable then stacks a second request on top
 * of the first at exactly the moment the provider is already struggling.
 */
export function withTimeout<T>(start: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => {
        // Reject before aborting, so the manager is told about the deadline
        // rather than about whatever the cancelled request throws on its way down.
        reject(new AiProviderError(`The coaching staff did not respond within ${ms}ms.`, true));
        controller.abort();
      }, ms);
    let pending: Promise<T>;
    try {
      pending = start(controller.signal);
    } catch (error) {
      clearTimeout(timer);
      reject(error);
      return;
    }
    pending.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}
