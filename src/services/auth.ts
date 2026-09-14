import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import type { Viewer } from '@/domain/visibility';

/**
 * Authentication.
 *
 * Passwords are hashed with scrypt and sessions are opaque random tokens stored
 * hashed in the database, so a database leak does not hand over live sessions.
 * No third-party auth dependency: a private league of eight friends does not
 * need one, and this keeps the security surface small and readable.
 */

const scryptAsync = promisify(scrypt);
const SESSION_COOKIE = 'aifl_session';
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const derived = (await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64)) as Buffer;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class AuthError extends Error {}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
}

export async function registerUser(input: RegisterInput) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AuthError('Enter a valid email address.');
  if (input.password.length < 10) throw new AuthError('Passwords must be at least 10 characters.');
  if (input.displayName.trim().length < 2) throw new AuthError('Enter a display name.');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AuthError('An account with that email already exists.');

  const isFirstUser = (await prisma.user.count()) === 0;
  return prisma.user.create({
    data: {
      email,
      displayName: input.displayName.trim(),
      passwordHash: await hashPassword(input.password),
      // The first account to be created administers the installation.
      isSuperAdmin: isFirstUser,
    },
  });
}

export async function authenticate(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  // Always run the hash comparison so a missing account and a wrong password
  // take the same amount of time.
  const stored = user?.passwordHash ?? 'scrypt$00$00';
  const ok = await verifyPassword(password, stored);
  if (!user || !ok) throw new AuthError('Email or password is incorrect.');
  return user;
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  return token;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  store.delete(SESSION_COOKIE);
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  isSuperAdmin: boolean;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    displayName: session.user.displayName,
    isSuperAdmin: session.user.isSuperAdmin,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError('You must sign in to do that.');
  return user;
}

/** Build the viewer context the visibility rules operate on. */
export async function getViewer(userId: string): Promise<Viewer> {
  const [user, memberships, clubs] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.leagueMembership.findMany({ where: { userId } }),
    prisma.club.findMany({ where: { ownerUserId: userId }, select: { id: true } }),
  ]);
  return {
    userId,
    clubIds: clubs.map((c) => c.id),
    leagueIds: memberships.map((m) => m.leagueId),
    isLeagueAdmin: memberships.some((m) => m.role === 'OWNER' || m.role === 'ADMIN'),
    isSuperAdmin: user?.isSuperAdmin ?? false,
  };
}
