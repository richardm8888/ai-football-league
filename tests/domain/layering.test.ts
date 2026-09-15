import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The dependency rules, enforced rather than described.
 *
 * "The match engine decides results, not the AI" is easy to state and easy to
 * break by accident six months later with one convenient import. Making it a
 * property of the module graph means breaking it fails the build instead of
 * quietly becoming true.
 *
 * These held by convention until a service was added that sits right at the
 * seam — applying a coaching proposal — which is exactly the kind of change
 * that would have broken them unnoticed.
 */

const SRC = path.join(process.cwd(), 'src');

function filesUnder(dir: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) entries.push(...filesUnder(full));
    else if (/\.tsx?$/.test(full)) entries.push(full);
  }
  return entries;
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

function offenders(fromDir: string, isForbidden: (spec: string) => boolean): string[] {
  return filesUnder(path.join(SRC, fromDir))
    .filter((file) => importsOf(file).some(isForbidden))
    .map((file) => path.relative(SRC, file));
}

describe('layering', () => {
  it('the match engine imports nothing but domain types', () => {
    // The engine performs no I/O and holds no clock, which is what makes a
    // result reproducible from its seed alone.
    const bad = offenders('engine', (spec) =>
      spec.startsWith('@/services') || spec.startsWith('@/ai')
      || spec.startsWith('@/app') || spec.startsWith('@/lib'));
    expect(bad).toEqual([]);
  });

  it('the services layer imports nothing from the AI layer', () => {
    // The simulator has no way to consult a model, even by accident. Breaking
    // this needs a deliberate import that a reviewer would see.
    expect(offenders('services', (spec) => spec.startsWith('@/ai'))).toEqual([]);
  });

  it('the domain imports no database client and no framework', () => {
    // What lets the bulk of the suite run with no database and no build step.
    const bad = offenders('domain', (spec) =>
      spec.startsWith('@/services') || spec.startsWith('@/ai') || spec.startsWith('@/app')
      || spec.startsWith('@/lib') || spec === '@prisma/client' || spec.startsWith('next'));
    expect(bad).toEqual([]);
  });
});
