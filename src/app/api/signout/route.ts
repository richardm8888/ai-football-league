import { NextResponse } from 'next/server';
import { clearSession } from '@/services/auth';

export async function POST(request: Request) {
  await clearSession();
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
