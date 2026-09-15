# AI costs

The game ships with a deterministic local coach, so most installations pay
nothing. Setting `ANTHROPIC_API_KEY` swaps that for a real language model, and
this is what that costs, where the money goes, and what is worth changing.

Every figure here comes from `npm run ai:cost`, which builds a real request
against a seeded league and measures it. The numbers below are for the defaults
in `src/lib/env.ts`: `claude-sonnet-5`, `AI_MAX_RETRIES=2`, `AI_TIMEOUT_MS=45000`.

## The short answer

A season of eight friends costs somewhere between **five and forty dollars**,
and about **thirteen** if they use it the way it is meant to be used. Per
instruction it is two to three cents. This is affordable to the point where the
interesting question is not whether to turn it on but whether anything is worth
optimising at all. Two of the levers below are, because they are nearly free to
make; the rest are real and not worth the churn at this bill.

The single thing most worth fixing is not a cost problem. `withTimeout` in
`src/ai/provider.ts` abandons a slow request without cancelling it, so the
generation completes and is billed anyway, and then the retry sends the whole
thing again. That is a correctness bug with a cost tail, and it should be fixed
first regardless of the bill.

## How the money is spent

One instruction is one API call. There is no agent loop: the model is given a
single tool, `tool_choice` forces it, and the one proposal it returns ends the
exchange. That matters more than any other structural fact here, because an
agentic loop resends its whole history every turn and this does not. A request
that costs two cents costs two cents once.

What gets sent is the system prompt, the tool schema, eleven labelled data
blocks of context, the staff notes, the last eight conversation turns, and the
manager's message.

## Measured tokens

Measured on the seeded league at matchday 8 in the Open phase, for a club with a
squad of 21, two staff notes and eight turns of history — that is, a manager
half a season in with a conversation already going, which is the expensive end
of normal. (The squad is 21 rather than the 20 the comment in
`src/domain/generation/squad.ts` claims; `SQUAD_SHAPE` below it sums to 21. That
is worth about 135 tokens.)

| Component | Characters | Tokens |
| --- | ---: | ---: |
| System prompt | 2,030 | 434 |
| Tool schema | 4,569 | 1,313 |
| context: `your_club` | 266 | 87 |
| context: `next_fixture` | 223 | 98 |
| context: `squad` | 7,584 | 2,832 |
| context: `tactical_familiarity` | 310 | 118 |
| context: `current_plan` | 941 | 370 |
| context: `current_training_plan` | 203 | 65 |
| context: `opponent_scouting_estimates` | 1,153 | 352 |
| context: `our_recent_matches` | 817 | 326 |
| context: `league_table` | 927 | 336 |
| context: `available_formations` | 982 | 323 |
| context: `available_roles` | 3,328 | 1,295 |
| Staff notes | 200 | 59 |
| Manager message | 134 | 33 |
| History, eight turns | 1,796 | 430 |
| **Whole request** | **25,391** | **8,491** |

Output depends entirely on what the proposal actually changes, and `max_tokens`
of 3,000 is never close to being reached:

| What the proposal contains | Tokens |
| --- | ---: |
| Advice only — message, rationale, risks | 265 |
| Tactics and training, no line-up | 631 |
| Tactics, line-up and training | 1,176 |

### A caveat about the token counts

The tokeniser for current models cannot be run offline, and this analysis was
done without an API key. The counts above come from the legacy Anthropic BPE,
which is the right family of tokeniser but an older generation of it. Modern
vocabularies split this kind of dense JSON into slightly fewer tokens, so every
figure here is a ceiling rather than a point estimate — if it is wrong it is
wrong in the direction of overstating the bill, which is the safe direction for
a decision about whether to switch the key on.

Set `ANTHROPIC_API_KEY` and `npm run ai:cost` uses the `count_tokens` endpoint
instead and prints exact figures. That endpoint does not run inference and costs
nothing to call, so re-checking this document is free.

A flat characters-per-token divisor was rejected deliberately: it is wrong by
enough to matter here. The same divisor cannot serve prose at 4.7 characters per
token and pretty-printed JSON at 2.7, and this request is mostly the latter.

## Cost per instruction

Claude Sonnet 5 is $2.00 per million input tokens and $10.00 per million output
tokens, as published on 2026-06-24. Prices move; `PRICES` in
`scripts/ai-cost.ts` is the one place to change them.

```
input    8,491 tokens  x  $2.00 / 1,000,000  =  $0.016982
output     631 tokens  x  $10.00 / 1,000,000 =  $0.006310
                                                ---------
one instruction that sets tactics and training  $0.023292
```

| Instruction | Input | Output | Cost |
| --- | ---: | ---: | ---: |
| A question, answered with advice | $0.0170 | $0.0027 | **$0.0197** |
| Tactics and training | $0.0170 | $0.0063 | **$0.0233** |
| Tactics, line-up and training | $0.0170 | $0.0118 | **$0.0287** |

Input is 73% of a typical instruction. That is the shape of this workload and it
is why every lever worth pulling acts on the request rather than the response.

## Cost per manager, per league, per season

The unit of play is the matchday, not the week. There is one deadline per
matchday and the match plays the moment the last manager locks in, so a league
that is all online can get through several matchdays in an evening. Eight clubs
play a double round-robin, which is **14 matchdays**.

How many instructions a manager sends is the one genuinely unknown number, so it
is modelled as a range rather than guessed at. A light manager says "sort it
out" and tweaks one thing. A chatty one asks who is injured, argues about the
shape, changes their mind, and asks again.

| | Per matchday | Instructions/season | Per manager/matchday | League/season |
| --- | ---: | ---: | ---: | ---: |
| Light | 2 | 224 | $0.051 | **$5.68** |
| Typical | 5 | 560 | $0.116 | **$13.04** |
| Heavy | 15 | 1,680 | $0.322 | **$36.06** |

```
typical:  5 instructions  x  $0.02328  =  $0.1164 per manager per matchday
          $0.1164  x  14 matchdays  x  8 managers  =  $13.04
```

The scenarios differ in output mix as well as volume, which is why the cost per
instruction is not flat across them: a light manager does the whole week in two
goes and so gets two full proposals, while a heavy one spends most of their
instructions asking cheap questions. A chatty manager also carries more history,
which is the only component of the request that grows with use.

## The levers

Ranked by what they save on one instruction that sets tactics and training. The
saving column is each lever's marginal contribution when they are applied in
this order, which is cheapest-and-safest first rather than largest first, so the
column adds up to the total. Applied alone, levers 1 and 2 save the same as they
do here; 3 to 5 save slightly more alone than they do stacked, because they
partly claim the same tokens.

| | Lever | Saving | Effort |
| --- | --- | ---: | --- |
| 1 | Stop pretty-printing the context JSON | 18.7pt | one line |
| 2 | Prompt caching on the tool schema and system prompt | 13.5pt | an hour |
| 3 | Move the roles and formation reference into the cached prefix | 6.5pt | an hour |
| 4 | Short player IDs | 2.3pt | half a day, some risk |
| 5 | Trimmed squad fields | 1.4pt | an hour, some risk |
| — | A cheaper model | 50% | small change, real quality risk |
| — | Retry and timeout hygiene | nothing on average | half a day |

They compose, and the compounding matters more than any one of them:

| Applied in order | Input tokens | Cost | Change |
| --- | ---: | ---: | ---: |
| Current code | 8,491 | $0.0233 | — |
| 1 compact JSON | 6,313 | $0.0189 | −18.7% |
| 2 + cache the tool schema and system prompt | 6,313 | $0.0158 | −32.2% |
| 3 + roles and formation reference made static | 6,378 | $0.0143 | −38.7% |
| 4 + short player IDs | 6,107 | $0.0137 | −41.1% |
| 5 + trimmed squad fields | 5,945 | $0.0134 | −42.5% |

Step 3 raises the input token count slightly while lowering the cost, which is
the point: the tokens move from the part of the request billed at full price to
the part billed at a tenth.

Across a season, the whole stack is worth about six dollars on typical use:

| | Instructions | Now | After steps 1–2 | After steps 1–5 |
| --- | ---: | ---: | ---: | ---: |
| Light | 224 | $5.68 | $4.00 | $3.23 |
| Typical | 560 | $13.04 | $8.84 | $6.92 |
| Heavy | 1,680 | $36.06 | $23.46 | $17.69 |

### Prompt caching is worth doing, but it is not the biggest lever

There is no `cache_control` anywhere in `src/ai`. That is confirmed, not
assumed: nothing in the source, the tests or the deployment config mentions it,
and the SDK is constructed with no caching options. The system prompt and tool
schema are re-sent and re-billed in full on every single request.

They are also the only genuinely static part of the prompt, and they come to
1,747 tokens — **21% of the input**. Caching reprices that fifth at a tenth of
the price, which is a 13.5% saving on a typical instruction. Worth having, and
it stays on once it is on, but the reason it is not transformative here is that
this workload is mostly unique per-request payload. The squad, the table, the
scouting and the plan change every week and cannot be cached at any price.

Two things about caching are specific to this app and easy to get wrong.

**The prefix is shared across the whole league.** The system prompt and tool
schema contain nothing about any particular club — that is a deliberate fairness
property, stated in `src/lib/env.ts`, and it happens to mean any manager's
request warms the cache for all eight. Around a deadline, when the match will not
play until everyone has locked in, managers cluster in the same evening and the
hit rate should be high.

**For a light manager, caching is a net surcharge.** A write costs 1.25× and an
entry lives five minutes, so somebody who sends two instructions an hour apart
pays the write twice and never reads it:

| Instructions | Sittings | Cached | Uncached | |
| ---: | ---: | ---: | ---: | ---: |
| 2 | 1 | $0.0047 | $0.0070 | −33% |
| 2 | 2 | $0.0087 | $0.0070 | **+25%** |
| 5 | 2 | $0.0098 | $0.0175 | −44% |
| 15 | 2 | $0.0133 | $0.0524 | −75% |
| 15 | 3 | $0.0173 | $0.0524 | −67% |

The surcharge is a fifth of a cent and not a reason to skip caching. It is a
reason not to reach for the one-hour TTL, which doubles the write cost and needs
three reads to repay itself — traffic this sparse will not always get them.

### Pretty-printing the context costs more than caching saves

`jsonBlock` in `src/ai/sanitize.ts` serialises with `JSON.stringify(value, null, 1)`.
Nothing downstream depends on that whitespace; the model reads compact JSON just
as well. Dropping the indent takes the context from 6,222 tokens to 4,044.

That is a **35% reduction in the context and 18.7% off the whole instruction,
from deleting one argument.** It saves more than prompt caching does, for
essentially no work and no risk. It is a larger saving in tokens than in
characters — 35% against 20% — because each newline and run of leading spaces
becomes its own token, and the squad block currently puts every attribute of
every player on a line of its own.

This is the change to make first.

### The squad block is the biggest single thing in the request

At 2,832 tokens it is a third of the input, and unlike the roles list it cannot
be cached, because it changes every week. Two things can be trimmed without
touching the advice:

**Player IDs are 25-character cuids.** Twenty-one of them go out in the squad
block and eighteen come back in the line-up, and they tokenise terribly — 2.3
characters per token, because they are opaque. Replacing them with per-request
handles (`p1`…`p21`) and translating back in the provider before validation
saves 271 input tokens and a similar number of output tokens. The translation
has to be exact, because the whole safety model rests on the line-up validating
against real squad members, so this is the one lever here with a real chance of
introducing a bug.

**One field is redundant and the rest are verbose.** `available` is derivable
from `status`, which already reads `available`, `injured: …` or
`suspended (n)`. Dropping it and shortening the remaining names to the
abbreviations the football world already uses — `ovr`, `fit`, `shp` — saves
another 162 tokens.

Together they are worth 3.7 points of an instruction. They are listed last among
the input levers because they are the only ones that carry risk, and at this
bill they do not repay it.

### `available_roles` should never have been in the per-request context

It is `ROLE_DEFINITIONS` serialised in full: 1,295 tokens, identical on every
request, for every club, forever. So is the `label` and `description` of every
formation. They sit in the message body, after the cacheable prefix, so they are
re-billed every time.

Moving them above the cache breakpoint takes the static prefix from 1,747
tokens to 2,665 — from 20.6% of the input to 31.4% — while the per-formation
familiarity numbers, which do vary, stay in the dynamic part. This is the one
place where the fix is structural rather than a tweak: `buildContextPrompt`
currently returns a single string, and it would need to return the static and
dynamic halves separately so the provider can put a breakpoint between them.

### A cheaper model saves more than everything else combined, and should not be used

Claude Haiku 4.5 is $1.00 and $5.00 per million tokens, exactly half Sonnet 5,
so it would halve the bill on any instruction it handled. Nothing else here
comes close. Three reasons not to:

**There is nothing to measure a regression with.** `tests/ai` is 47 cases and
they are good ones, but they assert safety and shape — that a proposal parses,
that it names only real players, that it cannot reach another club, that
injected text is inert. Not one of them asks whether the advice is any good.
There is no eval for advice quality, so a model swap would be an unmeasurable
change to the only part of the game the AI is actually for.

**Caching would silently stop working.** Haiku 4.5's minimum cacheable prefix is
4,096 tokens. The static prefix is 1,747, or 2,665 after step 3 — both below
it. There is no error for this; `cache_creation_input_tokens` just comes back
zero. So the model swap and the caching work are partly mutually exclusive, and
the combined saving is less than either figure suggests.

**Thirteen dollars a season is not a problem worth trading tactical judgement
for.** Reading a squad, weighing familiarity against a scouting estimate and
explaining the trade-off in football language is the whole product. If a model
tier were to change, it should be because a season of real use showed the advice
was good enough at the cheaper tier, not because it saved six dollars.

Routing simple instructions — "who is injured?" — to a cheaper model is more
defensible, since those are the ones with the least judgement in them. It is
still a per-instruction classifier that has to be right, to save about a cent a
time. Not now.

For completeness in the other direction: Claude Opus 5 would cost $0.0582 an
instruction, or $33 a season typical and $90 heavy. Also affordable, and a
reasonable thing to try if the advice ever feels thin.

### The retry policy is fine. The timeout is not.

`AI_MAX_RETRIES` defaults to 2, so a request can be sent three times. A fully
retried instruction costs $0.0573 against $0.0233, or **2.5×**, because each
attempt re-sends the whole input and only the last one produces output. That is
the correct trade: retries fire on 429s, 408s and 5xx, a manager who gets no
answer is a manager blocked before a deadline, and the local coach is waiting
behind it as a fallback. Two retries is the right number and it should stay.

The timeout is a different matter. `withTimeout` rejects its own promise but
never cancels the underlying request:

```ts
// src/ai/provider.ts
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AiProviderError(...)), ms);
    promise.then(...)
  });
}
```

There is no `AbortController` and no `signal` anywhere in `src/ai`. So when a
generation takes longer than 45 seconds, three things happen: the request runs to
completion on the server and is billed in full, the result is thrown away, and a
second request is immediately sent that stacks on top of the first. In the worst
case one instruction pays for three complete generations and the manager is
served by the local coach anyway. At `max_tokens` that is up to $0.0470 per
abandoned attempt.

This is worth fixing because a request that is billed and discarded is a bug, not
a tariff. The fix is to pass an `AbortSignal` through to `messages.create` and
abort it on timeout.

### Levers that do not apply

**Batch processing** is 50% off everything and is the second-largest free lever
in general, but a manager is waiting for every one of these responses. It cannot
be used.

**Effort and thinking budgets** are not set, and Sonnet 5 runs adaptive thinking
by default. Lowering effort is the conventional first tradeoff, but this is a
single-shot call with a small output and nothing here suggests reasoning depth is
where the tokens are going. The measurement says input is 73% of the bill.

**Context editing and compaction** need long accumulating loops. There is no
loop.

**Nothing logs `response.usage`.** Everything above is derived from the code and
a measured request rather than from real traffic, because there is no real
traffic to read. Adding the four usage counters to the `AiDecision` row the app
already writes per proposal would turn every number in this document into a
measurement, and it is a smaller change than any of the levers.

## What to change first

1. **Pass an `AbortSignal` into `messages.create`.** Not a saving — a bug. A
   timed-out request should stop costing money.
2. **Drop the `null, 1` from `jsonBlock`.** One line, 18.7% off every
   instruction, no risk.
3. **Log `response.usage` on every proposal.** So the next version of this
   document contains measurements instead of a ceiling.
4. **Add `cache_control` to the tool schema and system prompt.** An hour, 13.5%,
   and it compounds with (2) to 32%.

That is a morning's work for 32% and one real bug closed. Stop there. Steps 3
to 5 in the table above are correct and they are not worth the churn at this
bill; revisit them if a league ever turns out to send ten times more
instructions than modelled here.

The larger conclusion is that the architecture already did the expensive work.
One call per instruction, a forced tool so nothing is spent on prose that gets
thrown away, a 3,000-token ceiling that is never approached, eight turns of
history rather than an unbounded transcript, and a local fallback that means a
failed request degrades instead of retrying forever. A ten-turn agent loop over
this same context would resend the first turn ten times and pay roughly fifty
times as much per instruction, and no amount of caching would get that back.

## Re-checking these numbers

```bash
npm run pg:start
DATABASE_URL=postgresql://aifl:aifl@127.0.0.1:5433/aifl npm run db:deploy
SEED_MATCHDAYS=7 DATABASE_URL=postgresql://aifl:aifl@127.0.0.1:5433/aifl npm run db:seed
DATABASE_URL=postgresql://aifl:aifl@127.0.0.1:5433/aifl AI_PROVIDER=local npm run ai:cost
```

The script drives the real `askCoach` path to generate history and staff notes,
builds the context through `buildCoachContext`, and assembles the prompt with the
same functions `src/ai/providers/anthropic.ts` uses, so it cannot drift from what
would actually be sent. `AI_PROVIDER=local` keeps it from spending anything.

With `ANTHROPIC_API_KEY` set it counts tokens through `count_tokens`, which is
exact and free. `HISTORY_TURNS` and `AI_MODEL` change the scenario;
`SEED_MATCHDAYS` changes how much of a season has been played, which moves the
scouting and recent-match blocks.
