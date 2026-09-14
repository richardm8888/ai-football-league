'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import {
  applyProposalAction, askCoachAction, rejectProposalAction, type CoachActionState,
} from '@/app/actions/coach';
import { Alert, Badge, Card, ChipRow, Empty, humanise } from './ui';

/**
 * The coaching conversation.
 *
 * Built for a phone keyboard: the composer is pinned above the navigation, the
 * thread scrolls to the newest message, and suggested openers mean a manager can
 * start a useful conversation with one tap rather than a paragraph of typing.
 */

export interface CoachMessage {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  createdAt: string;
  rationale?: string;
  risks?: string[];
  questions?: string[];
  provider?: string;
  fallbackUsed?: boolean;
}

export interface CoachDecision {
  id: string;
  kind: string;
  status: string;
  summary: string;
  errors: string[];
  warnings: string[];
  createdAt: string;
}

const OPENERS = [
  'I want us to dominate possession but avoid being exposed in transition.',
  'We are weaker in midfield, so I want to protect the centre of the pitch.',
  'They press aggressively, so we should play around them rather than forcing short passes.',
  'I want us to start cautiously and become more attacking if we are behind.',
  'We should use our pace on the wings and attack the space behind their full-backs.',
];

export function CoachChat({
  clubId, matchdayId, coachName, coachPersona, messages, decisions, providerLabel, editable,
}: {
  clubId: string;
  matchdayId: string | null;
  coachName: string;
  coachPersona: string;
  messages: CoachMessage[];
  decisions: CoachDecision[];
  providerLabel: string;
  editable: boolean;
}) {
  const [askState, askAction] = useActionState(askCoachAction, {} as CoachActionState);
  const [applyState, applyAction] = useActionState(applyProposalAction, {} as CoachActionState);
  const [rejectState, rejectAction] = useActionState(rejectProposalAction, {} as CoachActionState);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const notice = askState.message ?? applyState.message ?? rejectState.message;
  const error = askState.error ?? applyState.error ?? rejectState.error;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600/20 text-lg">🎧</span>
          <div className="min-w-0">
            <p className="font-semibold">{coachName}</p>
            <p className="mt-0.5 text-xs text-ink-400">{coachPersona}</p>
            <p className="mt-1.5 text-[11px] text-ink-500">
              Running on {providerLabel}. Your staff advise and translate; you decide, and nothing
              changes until you approve it.
            </p>
          </div>
        </div>
      </Card>

      {notice && <Alert tone="good">{notice}</Alert>}
      {error && <Alert tone="warn" title="The coaching staff had a problem">{error}</Alert>}

      {decisions.length > 0 && (
        <Card>
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">
            Waiting for your decision
          </p>
          <ul className="space-y-3">
            {decisions.map((decision) => (
              <li key={decision.id} className="rounded-xl border border-line-700 bg-pitch-850 p-3">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <Badge tone="info">{humanise(decision.kind)}</Badge>
                  {decision.status === 'INVALID' && <Badge tone="bad">Failed validation</Badge>}
                </div>
                <p className="text-sm text-ink-200">{decision.summary}</p>

                {decision.errors.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-danger-400">
                    {decision.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                )}
                {decision.warnings.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-warn-400">
                    {decision.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <form action={applyAction}>
                    <input type="hidden" name="decisionId" value={decision.id} />
                    <button
                      type="submit"
                      disabled={decision.status === 'INVALID' || !editable}
                      className="min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-pitch-950 disabled:opacity-40"
                    >
                      Apply as draft
                    </button>
                  </form>
                  <form action={rejectAction}>
                    <input type="hidden" name="decisionId" value={decision.id} />
                    <button type="submit" className="min-h-11 rounded-xl border border-line-700 px-4 text-sm text-ink-200">
                      Dismiss
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="space-y-3">
        {messages.length === 0 && (
          <Empty>
            Tell your coaching staff how you want to play. They will read the squad and what the
            opposition have actually been doing, and come back with a plan you can edit.
          </Empty>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={message.role === 'USER' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[80%] ${
                message.role === 'USER'
                  ? 'bg-brand-600/20 text-ink-50'
                  : 'border border-line-700/60 bg-pitch-900'
              }`}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>

              {message.risks && message.risks.length > 0 && (
                <div className="mt-3 rounded-lg bg-warn-500/10 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-warn-400">Risks</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-200">
                    {message.risks.map((risk, i) => <li key={i}>{risk}</li>)}
                  </ul>
                </div>
              )}

              {message.questions && message.questions.length > 0 && (
                <div className="mt-2 rounded-lg bg-info-400/10 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-info-400">
                    They want to know
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-200">
                    {message.questions.map((question, i) => <li key={i}>{question}</li>)}
                  </ul>
                </div>
              )}

              {message.fallbackUsed && (
                <p className="mt-2 text-[11px] text-ink-500">Answered by the local coach.</p>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-[4.75rem] z-20 -mx-4 border-t border-line-700/60 bg-pitch-950/95 px-4 py-3 backdrop-blur">
        <ChipRow>
          {OPENERS.map((opener) => (
            <button
              key={opener}
              type="button"
              onClick={() => {
                if (inputRef.current) {
                  inputRef.current.value = opener;
                  inputRef.current.focus();
                }
              }}
              className="min-h-9 max-w-[16rem] truncate whitespace-nowrap rounded-full border border-line-700 bg-pitch-900 px-3 text-xs text-ink-300"
            >
              {opener}
            </button>
          ))}
        </ChipRow>
        <form action={askAction} className="mt-2 flex items-end gap-2">
          <input type="hidden" name="clubId" value={clubId} />
          <input type="hidden" name="matchdayId" value={matchdayId ?? ''} />
          <textarea
            ref={inputRef}
            name="message"
            rows={2}
            required
            enterKeyHint="send"
            placeholder="How do you want the team to play?"
            className="min-h-11 flex-1 resize-none rounded-xl border border-line-700 bg-pitch-850 px-3.5 py-2.5 text-ink-50 outline-none focus:border-brand-500"
          />
          <SendButton />
        </form>
      </div>
    </div>
  );
}

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 shrink-0 rounded-xl bg-brand-600 px-4 font-semibold text-pitch-950 disabled:opacity-50"
    >
      {pending ? 'Thinking…' : 'Send'}
    </button>
  );
}
