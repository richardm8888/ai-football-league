/** Environment configuration, read once and validated at first use. */

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}. Copy .env.example to .env.`);
  }
  return value;
}

export const env = {
  get databaseUrl(): string {
    return required('DATABASE_URL');
  },
  get sessionSecret(): string {
    return required('SESSION_SECRET');
  },
  get allowOpenRegistration(): boolean {
    return (process.env.ALLOW_OPEN_REGISTRATION ?? '1') === '1';
  },
  /**
   * AI configuration. A league standardises on one model so no manager has a
   * better assistant than another.
   */
  ai: {
    get provider(): 'anthropic' | 'local' {
      const configured = (process.env.AI_PROVIDER ?? 'anthropic').toLowerCase();
      if (configured === 'local') return 'local';
      // Without a key there is nothing to talk to, so fall back cleanly.
      return process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'local';
    },
    get apiKey(): string | undefined {
      return process.env.ANTHROPIC_API_KEY || undefined;
    },
    get model(): string {
      return process.env.AI_MODEL ?? 'claude-sonnet-5';
    },
    get timeoutMs(): number {
      return Number(process.env.AI_TIMEOUT_MS ?? 45000);
    },
    get maxRetries(): number {
      return Number(process.env.AI_MAX_RETRIES ?? 2);
    },
  },
};
