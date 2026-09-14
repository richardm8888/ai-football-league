/** Applied to every test worker before any module is imported. */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  ?? 'postgresql://aifl:aifl@127.0.0.1:5433/aifl_test';
process.env.SESSION_SECRET ??= 'test-secret-not-used-outside-tests';
process.env.AI_PROVIDER = 'local';
delete process.env.ANTHROPIC_API_KEY;
