/**
 * Prompt-injection defence.
 *
 * Club names, player names, notes and scouting text all end up inside a prompt.
 * Any of them could, in principle, carry text shaped like an instruction. Three
 * things keep that harmless:
 *
 *  1. Untrusted values are escaped and wrapped in labelled data blocks, and the
 *     system prompt says data blocks are never instructions.
 *  2. The model can only answer through a typed tool schema, so there is no free
 *     channel through which it could act on an injected instruction.
 *  3. Whatever comes back is revalidated against the squad and the tactical
 *     rules before a human is even shown it, and a human still has to approve.
 *
 * The escaping below is defence in depth, not the primary control.
 */

const CONTROL_CHARACTERS = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g');

/** Phrases whose only purpose in a data field is to redirect the model. */
const SUSPICIOUS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /disregard\s+(all\s+)?(previous|prior|above)/gi,
  /\byou\s+are\s+now\b/gi,
  /\bsystem\s*(prompt|message)\b/gi,
  /\b(new|updated)\s+instructions?\b/gi,
  /\bassistant\s*:/gi,
];

export interface SanitisedValue {
  value: string;
  /** True when something instruction-shaped was found and neutralised. */
  flagged: boolean;
}

export function sanitiseText(input: string | null | undefined, maxLength = 400): SanitisedValue {
  if (!input) return { value: '', flagged: false };
  let value = input.replace(CONTROL_CHARACTERS, ' ').slice(0, maxLength);
  let flagged = false;

  for (const pattern of SUSPICIOUS) {
    pattern.lastIndex = 0;
    if (pattern.test(value)) {
      flagged = true;
      pattern.lastIndex = 0;
      value = value.replace(pattern, '[removed]');
    }
  }

  // Angle brackets would otherwise let a value close the data block it sits in.
  if (value.includes('<') || value.includes('>')) {
    flagged = true;
    value = value.replace(/</g, '(').replace(/>/g, ')');
  }

  return { value: value.trim(), flagged };
}

/** Escape a value destined for a data block, without reporting. */
export function clean(input: string | null | undefined, maxLength = 400): string {
  return sanitiseText(input, maxLength).value;
}

/**
 * Wrap untrusted content in a labelled block. Everything inside is data the
 * model may read and reason about, and must never treat as an instruction.
 */
export function dataBlock(label: string, content: string): string {
  return `<data name="${label}">\n${content}\n</data>`;
}

export function jsonBlock(label: string, value: unknown): string {
  return dataBlock(label, JSON.stringify(value, null, 1));
}
