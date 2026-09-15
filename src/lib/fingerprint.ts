/**
 * A short, stable fingerprint of a string.
 *
 * Used to answer one question on the client: is what is on screen still what
 * the server last saved? The server echoes the fingerprint of the plan it
 * stored, the editor compares it with the plan it would submit now, and the
 * button can say "Saved" without ever claiming it about an edit that never
 * left the phone.
 *
 * FNV-1a, not a security primitive: nothing here defends against a chosen
 * collision, and nothing needs to.
 */
export function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    // Math.imul keeps the multiply by the 32-bit FNV prime in 32-bit integer
    // space; a plain * loses the low bits to floating point.
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
