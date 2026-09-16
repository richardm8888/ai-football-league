# AI costs

The game ships with a deterministic local coach, so most installations pay
nothing. Setting `ANTHROPIC_API_KEY` swaps that for a real language model, and
this is what that costs, where the money goes, and what is worth changing.

Every figure here comes from `npm run ai:cost`, which builds a real request
against a seeded league and measures it. The numbers below are for the defaults
in `src/lib/env.ts`: `claude-sonnet-5`, `AI_MAX_RETRIES=2`, `AI_TIMEOUT_MS=45000`.

## The short answer

A season of eight friends costs somewhere between **six and fifty dollars**,
and about **fourteen** if they use it the way it is meant to be used. Per
instruction it is two to four cents. The wide band is mostly how much the
managers talk to their staff; the rest is tokeniser uncertainty, explained
below. This is affordable to the point where the
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
| Tool-use system prompt, added by the API | — | 474 |
| **Whole request** | **25,391** | **8,965** |

That last row is billed but is not part of anything the app assembles. Sending
any tool at all makes the API prepend its own tool-use system prompt, and
forcing the choice with `tool_choice` costs more than leaving it automatic —
474 tokens against 354 on this model. It is invisible in the source, so it has
to be added by hand from the published per-model table.

Output depends entirely on what the proposal actually changes, and `max_tokens`
of 3,000 is never close to being reached:

| What the proposal contains | Tokens |
| --- | ---: |
| Advice only — message, rationale, risks | 265 |
| Tactics and training, no line-up | 631 |
| Tactics, line-up and training | 1,176 |

### A caveat about the token counts, and it cuts both ways

The tokeniser for current models cannot be run offline, and this analysis was
done without an API key. The counts above come from the legacy Anthropic BPE,
which is a real tokeniser of the right family but the wrong generation.

**The error does not run in a knowable direction.** Claude 4.7 and later models
use a newer tokeniser that produces roughly 30% more tokens for the same text
than the one used by Sonnet 4.6 and earlier. Sonnet 5 is on the newer one. How
the legacy Claude 1/2 BPE measured here compares to either is not published, so
a count taken from it can as easily be under as over — and the direction of the
known change is upward.

Treat the figures as the middle of a band, not a ceiling. At 30% above the
measured counts a typical instruction is $0.0312 rather than $0.0242, and a
typical season $17.49 rather than $13.57:

| | As measured | 30% higher |
| --- | ---: | ---: |
| Typical instruction | $0.0242 | $0.0312 |
| Light season | $5.90 | $7.79 |
| Typical season | $13.57 | $17.49 |
| Heavy season | $37.65 | $48.46 |

Nothing in the recommendation changes across that band, which is the only
reason it is acceptable to leave it open: the worst case is still under fifty
dollars for a whole season, and the ranking of the levers is unaffected because
they all scale with it.

Set `ANTHROPIC_API_KEY` and `npm run ai:cost` uses the `count_tokens` endpoint
instead and prints exact figures. That endpoint does not run inference and
costs nothing to call, so closing this gap is free and worth doing before
anyone relies on a precise number.

A flat characters-per-token divisor was rejected deliberately: it is wrong by
enough to matter here. The same divisor cannot serve prose at 4.7 characters
per token and pretty-printed JSON at 2.7, and this request is mostly the
latter.

## Cost per instruction

Claude Sonnet 5 is $2.00 per million input tokens and $10.00 per million output
tokens, as published on 2026-06-24. Prices move; `PRICES` in
`scripts/ai-cost.ts` is the one place to change them.

```
input    8,965 tokens  x  $2.00 / 1,000,000  =  $0.017930
output     631 tokens  x  $10.00 / 1,000,000 =  $0.006310
                                                ---------
one instruction that sets tactics and training  $0.024240
```

| Instruction | Input | Output | Cost |
| --- | ---: | ---: | ---: |
| A question, answered with advice | $0.0179 | $0.0027 | **$0.0206** |
| Tactics and training | $0.0179 | $0.0063 | **$0.0242** |
| Tactics, line-up and training | $0.0179 | $0.0118 | **$0.0297** |

Input is 74% of a typical instruction. That is the shape of this workload and it
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
| Light | 2 | 224 | $0.053 | **$5.90** |
| Typical | 5 | 560 | $0.121 | **$13.57** |
| Heavy | 15 | 1,680 | $0.336 | **$37.65** |

```
typical:  5 instructions  x  $0.02424  =  $0.1212 per manager per matchday
          $0.1212  x  14 matchdays  x  8 managers  =  $13.57
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
| 1 | Stop pretty-printing the context JSON | 18.0pt | one line |
| 2 | Prompt caching on the tool schema and system prompt | 16.5pt | an hour |
| 3 | Move the roles and formation reference into the cached prefix | 6.3pt | an hour |
| 4 | Short player IDs | 2.2pt | half a day, some risk |
| 5 | Trimmed squad fields | 1.3pt | an hour, some risk |
| — | A cheaper model | 50% | small change, real quality risk |
| — | Retry and timeout hygiene | nothing on average | half a day |

They compose, and the compounding matters more than any one of them:

| Applied in order | Input tokens | Cost | Change |
| --- | ---: | ---: | ---: |
| Current code | 8,965 | $0.0242 | — |
| 1 compact JSON | 6,787 | $0.0199 | −18.0% |
| 2 + cache the tool schema and system prompt | 6,787 | $0.0159 | −34.5% |
| 3 + roles and formation reference made static | 6,852 | $0.0144 | −40.7% |
| 4 + short player IDs | 6,581 | $0.0138 | −43.0% |
| 5 + trimmed squad fields | 6,419 | $0.0135 | −44.3% |

Step 3 raises the input token count slightly while lowering the cost, which is
the point: the tokens move from the part of the request billed at full price to
the part billed at a tenth.

Across a season, the whole stack is worth about seven dollars on typical use:

| | Instructions | Now | After steps 1–2 | After steps 1–5 |
| --- | ---: | ---: | ---: | ---: |
| Light | 224 | $5.90 | $4.02 | $3.26 |
| Typical | 560 | $13.57 | $8.90 | $6.97 |
| Heavy | 1,680 | $37.65 | $23.61 | $17.85 |

### Prompt caching is worth nearly as much as the biggest lever

There is no `cache_control` anywhere in `src/ai`. That is confirmed, not
assumed: nothing in the source, the tests or the deployment config mentions it,
and the SDK is constructed with no caching options. The system prompt and tool
schema are re-sent and re-billed in full on every single request.

They are also the only genuinely static part of the prompt, and with the
tool-use system prompt the API adds on top they come to 2,221 tokens — **25% of
the input**. Caching reprices that quarter at a tenth of the price, which is a
16.5% saving on a typical instruction. The reason it is not larger is that this
workload is mostly unique per-request payload: the squad, the table, the
scouting and the plan change every week and cannot be cached at any price.

The forced `tool_choice` helps here in a small way. It costs 120 tokens more
per request than leaving the choice automatic, but those tokens are part of the
static prefix, so once caching is on they are billed at a tenth. Keeping the
constraint is the right call for its own sake — it is what makes the proposal
the only thing the model can emit — and it is nearly free.

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
| 2 | 1 | $0.0060 | $0.0089 | −32% |
| 2 | 2 | $0.0111 | $0.0089 | **+25%** |
| 5 | 2 | $0.0124 | $0.0222 | −44% |
| 15 | 2 | $0.0169 | $0.0666 | −75% |
| 15 | 3 | $0.0220 | $0.0666 | −67% |

The surcharge is a fifth of a cent and not a reason to skip caching. It is a
reason not to reach for the one-hour TTL, which doubles the write cost and needs
three reads to repay itself — traffic this sparse will not always get them.

### Pretty-printing the context costs more than caching saves

`jsonBlock` in `src/ai/sanitize.ts` serialises with `JSON.stringify(value, null, 1)`.
Nothing downstream depends on that whitespace; the model reads compact JSON just
as well. Dropping the indent takes the context from 6,222 tokens to 4,044.

That is a **35% reduction in the context and 18.0% off the whole instruction,
from deleting one argument.** It edges out prompt caching — 18.0 points against
16.5 — but the two are close enough that the ordering is not the point. Do this
one first because it is one line and cannot fail, not because it saves more. It is a larger saving in tokens than in
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

Together they are worth 3.5 points of an instruction. They are listed last among
the input levers because they are the only ones that carry risk, and at this
bill they do not repay it.

### `available_roles` should never have been in the per-request context

It is `ROLE_DEFINITIONS` serialised in full: 1,295 tokens, identical on every
request, for every club, forever. So is the `label` and `description` of every
formation. They sit in the message body, after the cacheable prefix, so they are
re-billed every time.

Moving them above the cache breakpoint takes the static prefix from 2,221
tokens to 3,139 — from a quarter of the input to 35% — while the per-formation
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
4,096 tokens. The static prefix is 2,221, or 3,139 after step 3 — both below
it. Haiku 4.5 also needs 588 tokens for its own forced-tool system prompt
rather than 474, so a little of the saving goes straight back. There is no error for this; `cache_creation_input_tokens` just comes back
zero. So the model swap and the caching work are partly mutually exclusive, and
the combined saving is less than either figure suggests.

**Thirteen dollars a season is not a problem worth trading tactical judgement
for.** Reading a squad, weighing familiarity against a scouting estimate and
explaining the trade-off in football language is the whole product. If a model
tier were to change, it should be because a season of real use showed the advice
was good enough at the cheaper tier, not because it saved seven dollars.

Routing simple instructions — "who is injured?" — to a cheaper model is more
defensible, since those are the ones with the least judgement in them. It is
still a per-instruction classifier that has to be right, to save about a cent a
time. Not now.

For completeness in the other direction: Claude Opus 5 would cost $0.0606 an
instruction, or $34 a season typical and $94 heavy. Also affordable, and a
reasonable thing to try if the advice ever feels thin.

### The retry policy is fine. The timeout is not.

`AI_MAX_RETRIES` defaults to 2, so a request can be sent three times. A fully
retried instruction costs $0.0601 against $0.0242, or **2.5×**, because each
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
served by the local coach anyway. At `max_tokens` that is up to $0.0479 per
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
where the tokens are going. The measurement says input is 74% of the bill.

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
2. **Drop the `null, 1` from `jsonBlock`.** One line, 18.0% off every
   instruction, no risk.
3. **Log `response.usage` on every proposal.** So the next version of this
   document contains measurements instead of a ceiling.
4. **Add `cache_control` to the tool schema and system prompt.** An hour, 16.5%,
   and it compounds with (2) to 34.5%.

That is a morning's work for 34.5% and one real bug closed. Stop there. Steps 3
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
