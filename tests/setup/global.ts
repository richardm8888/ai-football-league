import { execSync } from 'node:child_process';

/**
 * Point the whole test run at a dedicated database and make sure its schema is
 * current. Tests that touch persistence share this database and clear it
 * between suites; the domain, engine and familiarity tests need none of it.
 */
export async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL
    ?? 'postgresql://aifl:aifl@127.0.0.1:5433/aifl_test';
  process.env.DATABASE_URL = url;
  process.env.SESSION_SECRET ??= 'test-secret-not-used-outside-tests';
  process.env.AI_PROVIDER = 'local';
  delete process.env.ANTHROPIC_API_KEY;

  try {
    execSync('npx prisma migrate deploy', {
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: url },
    });
  } catch (error) {
    throw new Error(
      'Could not migrate the test database. Start one with `npm run pg:start`, '
      + 'or set TEST_DATABASE_URL.\n'
      + String((error as { stdout?: Buffer }).stdout ?? error));
  }
}
