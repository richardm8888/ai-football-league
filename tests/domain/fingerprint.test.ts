import { describe, expect, it } from 'vitest';
import { fingerprint } from '@/lib/fingerprint';

/**
 * The fingerprint behind "Saved ✓".
 *
 * The button claims the plan on screen is the plan on the server. That claim is
 * only as good as this: the same plan must fingerprint the same way on every
 * render, and any edit at all must change it, or a manager is told their change
 * is safe when it is still sitting on their phone.
 */
describe('fingerprint', () => {
  it('is stable for the same value', () => {
    const plan = JSON.stringify({ formation: 'F_4_3_3', pressing: 'HIGH' });
    expect(fingerprint(plan)).toBe(fingerprint(plan));
  });

  it('changes when anything in the value changes', () => {
    const before = JSON.stringify({ formation: 'F_4_3_3', pressing: 'HIGH' });
    const after = JSON.stringify({ formation: 'F_4_3_3', pressing: 'MEDIUM' });
    expect(fingerprint(before)).not.toBe(fingerprint(after));
  });

  it('notices a single character, including one deep in a long plan', () => {
    const long = 'x'.repeat(4000);
    expect(fingerprint(`${long}a${long}`)).not.toBe(fingerprint(`${long}b${long}`));
  });

  it('is a short hex string whatever it is given', () => {
    for (const value of ['', 'a', JSON.stringify({ a: [1, 2, 3] })]) {
      expect(fingerprint(value)).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});
