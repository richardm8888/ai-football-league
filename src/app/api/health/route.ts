import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// A deploy needs to distinguish "the process started" from "the app works".
// The container can serve this route perfectly while Prisma cannot reach
// Postgres, which is a dead site to anyone using it, so the check does a real
// round-trip rather than returning a constant.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    // The error itself is deliberately not returned: this endpoint is
    // unauthenticated, and connection errors carry host names and credentials.
    return NextResponse.json({ status: 'error', database: false }, { status: 503 });
  }

  return NextResponse.json({ status: 'ok', database: true });
}
