'use server';

import { markTourSeen } from '@/services/auth';
import { requireUser } from '@/services/page-context';

/**
 * The first-run walkthrough, remembered.
 *
 * Dismissing it any way at all — finishing it, skipping it, closing it — counts
 * as having seen it. Anything else would be a nag, and a manager who wants it
 * again has a link for that.
 *
 * It fails quietly on purpose: not recording that someone saw the tour is worth
 * far less than an error thrown over a screen they have already closed.
 */
export async function markTourSeenAction(): Promise<void> {
  try {
    const user = await requireUser();
    await markTourSeen(user.id);
  } catch {
    // Nothing the manager can do about it, and nothing they need told.
  }
}
