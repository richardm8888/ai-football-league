# AI costs

The game ships with a deterministic local coach, so most installations pay
nothing. Setting `ANTHROPIC_API_KEY` swaps that for a real language model, and
this is what that costs, where the money goes, and what is worth changing.

Every figure here comes from `npm run ai:cost`, which builds a real request
against a seeded league and measures it. The numbers below are for the defaults
in `src/lib/env.ts`: `claude-sonnet-5`, `AI_MAX_RETRIES=2`, `AI_TIMEOUT_MS=45000`.

This document was first written on 15 September against the code as it then
stood, and recommended four changes. All four have since landed: #21 cancels a
timed-out request, and #22 compacted the context JSON, added prompt caching and
started recording `response.usage`. The figures here are measured against the
optimised code, with the pre-optimisation numbers kept alongside them, because
the comparison is more useful than either on its own.

## The short answer

A season of eight friends costs somewhere between **four and twenty-five
dollars**, and about **nine** if they use it the way it is meant to be used —
or up to about thirty-two at the heavy end once tokeniser uncertainty is
allowed for. Per instruction it is one to two cents. The wide band is mostly how
much the managers talk to their staff.

This is affordable to the point where the interesting question is not whether to
turn it on but whether anything further is worth optimising. The answer, for
now, is no: the two cheap levers have been pulled, and the three that remain are
worth about two dollars a season against a change to the code path carrying the
one safety property worth protecting.

## How the money is spent

One instruction is one API call. There is no agent loop: the model is given a
single tool, `tool_choice` forces it, and the one proposal it returns ends the
exchange. That matters more than any other structural fact here, because an
agentic loop resends its whole history every turn and this does not. A request
that costs under two cents costs that once.

What gets sent is the system prompt, the tool schema, eleven labelled data
blocks of context, the staff notes, the last eight conversation turns, and the
manager's message. The system prompt and the tool schema carry a `cache_control`
breakpoint each, so on any request that follows another within five minutes they
are billed at a tenth.

## Measured tokens

Measured on the seeded league at matchday 7 in the post-match phase, for a club
with a squad of 21, two staff notes and eight turns of history — that is, a
manager half a season in with a conversation already going, which is the
expensive end of normal. (The squad is 21 rather than the 20 the comment in
`src/domain/generation/squad.ts` claims; `SQUAD_SHAPE` below it sums to 21. That
is worth about 90 tokens.)

| Component | Characters | Tokens |
| --- | ---: | ---: |
| System prompt | 2,030 | 434 |
| Tool schema | 4,569 | 1,313 |
| context: `your_club` | 240 | 67 |
| context: `next_fixture` | 210 | 76 |
| context: `squad` | 5,985 | 1,846 |
| context: `tactical_familiarity` | 259 | 85 |
| context: `current_plan` | 806 | 277 |
| context: `current_training_plan` | 184 | 49 |
| context: `opponent_scouting_estimates` | 1,115 | 265 |
| context: `our_recent_matches` | 656 | 220 |
| context: `league_table` | 732 | 223 |
| context: `available_formations` | 881 | 257 |
| context: `available_roles` | 2,472 | 686 |
| Staff notes | 200 | 59 |
| Manager message | 134 | 33 |
| History, eight turns | 2,169 | 501 |
| Tool-use system prompt, added by the API | — | 474 |
| **Whole request** | **22,662** | **6,885** |
| *The same request before #22, pretty-printed* | *26,064* | *9,077* |

That tool-use row is billed but is not part of anything the app assembles.
Sending any tool at all makes the API prepend its own tool-use system prompt,
and forcing the choice with `tool_choice` costs more than leaving it automatic —
474 tokens against 354 on this model. It is invisible in the source, so it has
to be added by hand from the published per-model table.

Of those 6,885 input tokens, 2,221 are the cacheable prefix: the system prompt,
the tool schema and the API's own tool-use prompt. That is 32% of the request,
and on a warm cache it bills as though the whole request were 4,886 tokens.

Output depends entirely on what the proposal actually changes, and `max_tokens`
of 3,000 is never close to being reached:

| What the proposal contains | Tokens |
| --- | ---: |
| Advice only — message, rationale, risks | 304 |
| Tactics and training, no line-up | 674 |
| Tactics, line-up and training | 1,236 |

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
measured counts a typical instruction is $0.0215 rather than $0.0165, and a
typical season $12.03 rather than $9.25:

| | As measured | 30% higher |
| --- | ---: | ---: |
| Typical instruction | $0.0165 | $0.0215 |
| Light season | $4.16 | $5.41 |
| Typical season | $9.25 | $12.03 |
| Heavy season | $24.63 | $32.02 |

Nothing in the recommendation changes across that band, which is the only
reason it is acceptable to leave it open: the worst case is still about thirty
dollars for a whole season, and the ranking of the levers is unaffected because
they all scale with it.

Set `ANTHROPIC_API_KEY` and `npm run ai:cost` uses the `count_tokens` endpoint
instead and prints exact figures. That endpoint does not run inference and
costs nothing to call, so closing this gap is free and worth doing before
anyone relies on a precise number.

A flat characters-per-token divisor was rejected deliberately: it is wrong by
enough to matter here. The same divisor cannot serve prose at 4.7 characters
per token and compact JSON at 3.3, and this request is mostly the latter.

### And a second caveat: the seeded league is not the same league twice

Re-seeding does not reproduce the measurement exactly. The match engine is
deterministic given a seed, but `fixtureSeed` in `src/engine/rng.ts` builds that
seed out of the season and fixture database IDs, which are fresh cuids on every
seed run. So each seeded league plays a different set of matches, and the form,
injuries, scouting estimates, league table and conversation history that follow
from them all differ too.

Across five clean seeds the whole request ranged from 6,720 to 6,885 tokens, and
a typical season from $8.52 to $9.25 — about ±2% either side. The **ratios are
far steadier than the totals**: compacting the JSON measured between −24.1% and
−24.6% on every one of them. That is why the conclusions here survive a re-seed
even though the absolute counts move, and why the percentages in this document
deserve more confidence than the token counts.

## Cost per instruction

Claude Sonnet 5 is $2.00 per million input tokens and $10.00 per million output
tokens, as published on 2026-06-24. Cache reads bill at a tenth of the input
rate and five-minute cache writes at 1.25 times it. Prices move; `PRICES` in
`scripts/ai-cost.ts` is the one place to change them.

```
uncached input   4,664 tokens  x  $2.00 / 1,000,000         =  $0.009328
cached prefix    2,221 tokens  x  $2.00 / 1,000,000  x 0.1  =  $0.000444
output             674 tokens  x  $10.00 / 1,000,000        =  $0.006740
                                                               ---------
one instruction that sets tactics and training                 $0.016512
```

| Instruction | Input | Output | Cost |
| --- | ---: | ---: | ---: |
| A question, answered with advice | $0.0098 | $0.0030 | **$0.0128** |
| Tactics and training | $0.0098 | $0.0067 | **$0.0165** |
| Tactics, line-up and training | $0.0098 | $0.0124 | **$0.0221** |

Input is 59% of a typical instruction. It was 73% before caching, and the drop
is the point: caching did not remove input tokens, it repriced a third of them
at a tenth. Input still dominates, so the levers that remain still act on the
request rather than the response — but by a narrower margin than before, and an
output-side lever is no longer obviously pointless the way it was.

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
| Light | 2 | 224 | $0.037 | **$4.16** |
| Typical | 5 | 560 | $0.083 | **$9.25** |
| Heavy | 15 | 1,680 | $0.220 | **$24.63** |

```
typical:  5 instructions  x  $0.01651  =  $0.0826 per manager per matchday
          $0.0826  x  14 matchdays  x  8 managers  =  $9.25
```

The scenarios differ in output mix as well as volume, which is why the cost per
instruction is not flat across them: a light manager does the whole week in two
goes and so gets two full proposals, while a heavy one spends most of their
instructions asking cheap questions. A chatty manager also carries more history,
which is the only component of the request that grows with use — and gets the
best of the caching, because their instructions cluster into sittings.

## What the optimisation work actually bought

The two cheap levers were predicted to be worth 18.0 and 16.5 points of an
instruction. They landed at 17.6 and 16.1. Prediction and outcome agree closely
enough that the method is worth keeping.

| | Predicted, 15 Sep | Measured in #22 | Re-measured now |
| --- | ---: | ---: | ---: |
| Compacting the JSON, on billed input tokens | — | −24.3% | −24.1% |
| Compacting the JSON, on the cost of an instruction | −18.0% | −18.1% | −17.6% |
| Caching, marginal on top of that | −16.5pt | — | −16.1pt |
| Both, on a warm prefix | −34.5% | −34.5% | −33.7% |
| Both, on the first instruction of a sitting | — | −13.6% | −13.1% |

**The two headline numbers that look like a disagreement are the same
measurement with different denominators.** The analysis predicted 18%; #22
reported 24.3%; both are right. 24.3% is the reduction in billed *input tokens*,
and 18% is the reduction in the *cost of an instruction*, which includes output
tokens the change does not touch. Input was 73% of the bill before the change,
and 24.1% x 0.73 = 17.6%, which is exactly what the cost column says. Anyone
re-checking this should be careful which of the two they are quoting: the token
figure is the larger and more flattering one, and it is not the figure that
appears on the invoice.

The one genuine divergence is on the other side of caching, and it is a
difference of scenario rather than of arithmetic. A cached prefix helps only if
a previous request warmed it, so the first instruction of a sitting pays the
1.25x write instead of the 0.1x read and comes out at −13.1% rather than −33.7%.
A manager who sends a single instruction and closes the tab never reads the
cache at all, and pays slightly more than they would have before #22. The season
figures above already account for this through the sittings model; the
per-instruction figures assume a warm prefix, which is the common case but not
the universal one.

### The levers, and where they stand

Ranked by what they save on one instruction that sets tactics and training. The
saving column is each lever's marginal contribution when they are applied in
this order, which is cheapest-and-safest first rather than largest first, so the
column adds up to the total.

| | Lever | Saving | Status |
| --- | --- | ---: | --- |
| 1 | Stop pretty-printing the context JSON | 17.6pt | **Done, #22** |
| 2 | Prompt caching on the tool schema and system prompt | 16.1pt | **Done, #22** |
| 3 | Move the roles and formation reference into the cached prefix | 6.1pt | Left, deliberately |
| 4 | Short player IDs | 2.3pt | Left, deliberately |
| 5 | Trimmed squad fields | 1.3pt | Left, deliberately |
| — | A cheaper model | 37% | Rejected, see below |
| — | Retry and timeout hygiene | nothing on average | **Done, #21** |

They compose, and the compounding matters more than any one of them:

| Applied in order | Input tokens | Cost | Change |
| --- | ---: | ---: | ---: |
| Before #22 | 9,077 | $0.0249 | — |
| 1 compact JSON | 6,885 | $0.0205 | −17.6% |
| 2 + cache the tool schema and system prompt — **current code** | 6,885 | $0.0165 | −33.7% |
| 3 + roles and formation reference made static | 6,950 | $0.0150 | −39.8% |
| 4 + short player IDs | 6,666 | $0.0144 | −42.1% |
| 5 + trimmed squad fields | 6,504 | $0.0141 | −43.4% |

Step 3 raises the input token count slightly while lowering the cost, which is
the point: the tokens do not go away, they move from the part of the request
billed at full price to the part billed at a tenth.

Across a season, the work that has landed is worth about five dollars on typical
use, and everything left on the table is worth about two:

| | Instructions | Before #22 | Now | After steps 3–5 |
| --- | ---: | ---: | ---: | ---: |
| Light | 224 | $6.04 | $4.16 | $3.35 |
| Typical | 560 | $13.94 | $9.25 | $7.23 |
| Heavy | 1,680 | $38.71 | $24.63 | $18.58 |

### Prompt caching was worth nearly as much as the biggest lever

The system prompt and the tool schema are the only genuinely static part of the
prompt, and with the tool-use system prompt the API adds on top they come to
2,221 tokens — a quarter of the pre-#22 input.
`src/ai/providers/anthropic.ts` now carries a `cache_control` breakpoint on each,
at the five-minute TTL, which reprices that quarter at a tenth: 16.1 points of a
typical instruction. The reason it is not larger is that this workload is mostly
unique per-request payload — the squad, the table, the scouting and the plan
change every week and cannot be cached at any price.

**Two breakpoints rather than one.** Requests render as tools, then system, then
messages, so the breakpoint on the system prompt already covers both. The second
one, at the end of the tool schema, means editing the system prompt — which
happens on a deploy, not per request — does not also discard the larger tool
schema entry.

**Five minutes, not an hour.** The hourly TTL doubles the write cost and so
needs three reads to repay itself rather than two, and traffic this sparse will
not reliably supply them.

The forced `tool_choice` helps here in a small way. It costs 120 tokens more per
request than leaving the choice automatic, but those tokens are part of the
static prefix, so they are now billed at a tenth. Keeping the constraint is the
right call for its own sake — it is what makes the proposal the only thing the
model can emit — and it is nearly free.

Two things about caching are specific to this app and easy to get wrong.

**The prefix is shared across the whole league.** The system prompt and tool
schema contain nothing about any particular club — that is a deliberate fairness
property, stated in `src/lib/env.ts`, and it happens to mean any manager's
request warms the cache for all eight. Around a deadline, when the match will not
play until everyone has locked in, managers cluster in the same evening and the
hit rate should be high. `tests/ai/caching.test.ts` asserts the prefix is
byte-identical across two different clubs, because that property is what the
league-wide saving depends on and nothing else would notice if it broke.

**For a light manager, caching is a net surcharge.** A write costs 1.25x and an
entry lives five minutes, so somebody who sends two instructions an hour apart
pays the write twice and never reads it:

| Instructions | Sittings | Cached | Uncached | |
| ---: | ---: | ---: | ---: | ---: |
| 2 | 1 | $0.0060 | $0.0089 | −32% |
| 2 | 2 | $0.0111 | $0.0089 | **+25%** |
| 5 | 2 | $0.0124 | $0.0222 | −44% |
| 15 | 2 | $0.0169 | $0.0666 | −75% |
| 15 | 3 | $0.0220 | $0.0666 | −67% |

The surcharge is a fifth of a cent. It was not a reason to skip caching, and it
remains the reason not to reach for the one-hour TTL.

**Caching fails silently.** A prefix that stops matching, or one shorter than the
model's minimum cacheable length, is billed at full price with no error at all.
That is why `tests/ai/caching.test.ts` is a standing check rather than a one-time
look, and why the usage counters below matter more than they look. No test here
can assert a non-zero `cache_read_input_tokens` — that needs a real key and a
second request inside five minutes — so production is the only place this gets
confirmed.

### Pretty-printing the context cost more than caching saved

`jsonBlock` in `src/ai/sanitize.ts` used to serialise with
`JSON.stringify(value, null, 1)`. Nothing downstream depended on that
whitespace; the model reads compact JSON just as well. #22 dropped the indent,
which took the context from 6,263 tokens to 4,071.

That was a **35% reduction in the context and 17.6% off the whole instruction,
from deleting one argument.** It edged out prompt caching — 17.6 points against
16.1 — but the two were close enough that the ordering was never the point. It
went first because it is one line and cannot fail, not because it saved more. It
was a larger saving in tokens than in characters — 35% against 20% — because
each newline and run of leading spaces became its own token, and the squad block
put every attribute of every player on a line of its own.

### The squad block is still the biggest single thing in the request

At 1,846 tokens it is 27% of the input, and unlike the roles list it cannot be
cached, because it changes every week. Two things could be trimmed without
touching the advice. Neither has been done.

**Player IDs are 25-character cuids.** Twenty-one of them go out in the squad
block and eighteen come back in the line-up, and they tokenise terribly — 2.3
characters per token, because they are opaque. Replacing them with per-request
handles (`p1`…`p21`) and translating back in the provider before validation
saves 284 input tokens and a similar number of output tokens. The translation
has to be exact, because the whole safety model rests on the line-up validating
against real squad members, so this is the lever here with a real chance of
introducing a bug.

**One field is redundant and the rest are verbose.** `available` is derivable
from `status`, which already reads `available`, `injured: …` or
`suspended (n)`. Dropping it and shortening the remaining names to the
abbreviations the football world already uses — `ovr`, `fit`, `shp` — saves
another 162 tokens.

Together they are worth 3.6 points of an instruction. They are listed last among
the input levers because they are the only ones that carry risk, and at this
bill they do not repay it.

### `available_roles` should never have been in the per-request context

It is `ROLE_DEFINITIONS` serialised in full: 686 tokens, identical on every
request, for every club, forever. So is the `label` and `description` of every
formation. They sit in the message body, after the cacheable prefix, so they are
re-billed every time.

Moving them above the cache breakpoint would take the static prefix from 2,221
tokens to 3,139 — from 32% of the request to 45% — while the per-formation
familiarity numbers, which do vary, stay in the dynamic part. This is the one
place where the fix is structural rather than a tweak: `buildContextPrompt`
returns a single string, and it would need to return the static and dynamic
halves separately so the provider can put a breakpoint between them.

Compacting the JSON has made this lever smaller than it was — the roles block
was 1,295 tokens pretty-printed and is 686 now — which is part of why it did not
make the cut.

### A cheaper model saves more than everything left, and should not be used

Claude Haiku 4.5 is $1.00 and $5.00 per million tokens, exactly half Sonnet 5.
On the current request it comes out at $0.0104 against $0.0165, which is 37%
rather than the 50% the headline rates suggest. Three reasons not to:

**Caching would silently stop working, and that is where the missing 13 points
went.** Haiku 4.5's minimum cacheable prefix is 4,096 tokens. The static prefix
is 2,335 tokens on that model — larger than on Sonnet 5, because Haiku needs 588
tokens for its own forced-tool system prompt rather than 474 — and still well
below the minimum. There is no error for this; `cache_creation_input_tokens`
just comes back zero. So the model swap and the caching work are partly mutually
exclusive: moving to Haiku would hand back most of lever 2 to get the model
saving. Step 3 would not rescue it either, since 3,139 is still under 4,096.

| Model | Static prefix | Minimum cacheable | Caches? |
| --- | ---: | ---: | --- |
| `claude-opus-5` | 2,153 | 512 | yes |
| `claude-sonnet-5` | 2,221 | 1,024 | yes |
| `claude-haiku-4-5` | 2,335 | 4,096 | **no** |

**There is nothing to measure a regression with.** `tests/ai` is 56 cases and
they are good ones, but they assert safety and shape — that a proposal parses,
that it names only real players, that it cannot reach another club, that
injected text is inert. Not one of them asks whether the advice is any good.
There is no eval for advice quality, so a model swap would be an unmeasurable
change to the only part of the game the AI is actually for.

**Nine dollars a season is not a problem worth trading tactical judgement for.**
Reading a squad, weighing familiarity against a scouting estimate and explaining
the trade-off in football language is the whole product. If a model tier were to
change, it should be because a season of real use showed the advice was good
enough at the cheaper tier, not because it saved three dollars.

Routing simple instructions — "who is injured?" — to a cheaper model is more
defensible, since those are the ones with the least judgement in them. It is
still a per-instruction classifier that has to be right, to save well under a
cent a time. Not now.

For completeness in the other direction: Claude Opus 5 would cost $0.0412 an
instruction, or about $23 a season typical and $62 heavy. Also affordable, and a
reasonable thing to try if the advice ever feels thin.

### The retry policy is fine, and the timeout has been fixed

`AI_MAX_RETRIES` defaults to 2, so a request can be sent three times. A fully
retried instruction costs $0.0412 against $0.0165, or **2.5x**, because each
attempt re-sends the whole input and only the last one produces output. (The
retries are cheaper than they look: they follow within seconds, so the second
and third attempts read the cached prefix rather than re-writing it.) That is
the correct trade: retries fire on 429s, 408s and 5xx, a manager who gets no
answer is a manager blocked before a deadline, and the local coach is waiting
behind it as a fallback. Two retries is the right number and it should stay.

The timeout used to be a different matter. `withTimeout` rejected its own promise
but never cancelled the underlying request, so a generation that took longer than
45 seconds ran to completion on the server, was billed in full, was thrown away,
and was immediately followed by a second request stacked on top of the first — up
to $0.0398 per abandoned attempt at `max_tokens`, and it did that stacking at
exactly the moment the provider was already struggling.

#21 fixed it. `withTimeout` now starts the operation with an `AbortSignal` of its
own rather than taking a promise already in flight, and aborts it when the
deadline passes; the provider passes that signal to `messages.create`.
`withRetries` hands each attempt a fresh signal, so a retry replaces its
predecessor instead of joining it. The failure shape is deliberately unchanged:
the deadline rejection is raised before the abort, so the manager is told about
the deadline rather than about whatever the cancelled request throws on its way
down.

### Levers that do not apply

**Batch processing** is 50% off everything and is the second-largest free lever
in general, but a manager is waiting for every one of these responses. It cannot
be used.

**Effort and thinking budgets** are not set, and Sonnet 5 runs adaptive thinking
by default. Lowering effort is the conventional first tradeoff, but this is a
single-shot call with a small output and nothing here suggests reasoning depth is
where the tokens are going. The measurement says input is 59% of the bill.

**Context editing and compaction** need long accumulating loops. There is no
loop.

## What `response.usage` now records, and the gap in it

#22 made the fourth recommendation real. The provider returns `response.usage`,
`src/ai/coach.ts` lands the four counters on the `AiDecision` row the call
produced, and a migration added the columns. Two judgement calls in that work are
worth knowing about before anyone sums the column:

**The counters are nullable, not defaulted to zero.** The local coach makes no
API call and so has nothing to report. Null means unmeasured and averages
correctly; zero would quietly drag any per-instruction average down.

**They are recorded once per call, not once per row.** One call can propose
tactics, training and a scouting summary at once, and the app writes a row for
each. Writing the same counters onto all three would make any later `SUM` a
multiple of the real spend, so they go on the first row of the turn and stay null
on the rest.

**The known gap, declared by #22.** An instruction answered with advice alone —
no tactics, no training, no scouting — creates no `AiDecision` row at all, so it
records no usage. Those are the cheapest instructions and, on the model above, a
large share of a chatty manager's traffic. The effect is that **recorded output
tokens skew slightly high**, because the cheap short answers are missing from the
sample. Input tokens are unaffected: they barely vary with the shape of the
proposal, and every instruction that does write a row sends about the same
request. The fix would be to hang usage off the assistant `AiMessage` instead,
which is written once per turn unconditionally. It was left alone because #20
specified `AiDecision`, and this is a reporting skew rather than a wrong number —
but it should be closed before anyone uses the recorded output figures to
re-derive a cost per instruction.

Until enough real traffic accumulates, every number in this document remains
derived from a measured request rather than from an invoice. The counters are
what will eventually replace them.

## What was done, and what was deliberately left

Done, in the order the analysis recommended:

1. **An `AbortSignal` into `messages.create`** (#21). Not a saving — a bug. A
   timed-out request no longer costs money.
2. **The `null, 1` dropped from `jsonBlock`** (#22). One line, 17.6% off every
   instruction, no risk.
3. **`response.usage` recorded on every proposal** (#22), so a future version of
   this document can contain measurements rather than a ceiling.
4. **`cache_control` on the tool schema and system prompt** (#22), which
   compounds with (2) to 33.7%.

That was a morning's work for 33.7% and one real bug closed. It also required
upgrading `@anthropic-ai/sdk` from 0.32.1 to 0.126.0: prompt caching is GA on the
stable messages endpoint, but the pinned version predated that and had no
`cache_control` on `Tool` or `TextBlockParam`, and no cache counters on `Usage`
outside a deprecated beta namespace. Implementing caching on the old SDK would
have meant casting past the type system on the one change whose correctness
cannot be checked locally and whose failure mode is silent.

Left deliberately, and still correct:

- **`available_roles` above the cache breakpoint** (6.1pt). Structural: it needs
  `buildContextPrompt` split into static and dynamic halves.
- **Short player IDs** (2.3pt). The translation back has to be exact, because the
  safety model rests on the line-up validating against real squad members.
- **Trimmed squad fields** (1.3pt).

Together they are worth about ten points of an instruction and two dollars a
season on typical use, against a change to the code path that carries the one
safety property worth protecting. That is not a good trade at this bill.

**When to revisit.** Take them up if a league turns out to send roughly ten times
more instructions than modelled here; or if the recorded usage counters show real
traffic running well above the heavy scenario; or if a future model raises the
minimum cacheable prefix above 2,221 tokens, at which point lever 3 stops being
optional because it is the only thing that gets the prefix back over the line.

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
export DATABASE_URL=postgresql://aifl:aifl@127.0.0.1:5433/aifl
SEED_MATCHDAYS=7 npx prisma migrate reset --force --skip-generate
AI_PROVIDER=local npm run ai:cost
```

**The reset matters, and the older instructions were wrong to omit it.**
`npm run db:seed` on its own is a no-op when a league already exists — it prints
a message and returns unless `SEED_FORCE=1` is set — and `ai:cost` drives the
real `askCoach` path, so it appends eight turns of conversation to the club every
time it runs. Measuring twice against the same database therefore measures a
longer history the second time, and quietly reports a bigger request.
`migrate reset` drops and re-seeds, which is the only way to get a comparable
run. Expect the ±2% between seeds described above regardless.

The script drives the real `askCoach` path to generate history and staff notes,
builds the context through `buildCoachContext`, and assembles the prompt with the
same functions `src/ai/providers/anthropic.ts` uses, so it cannot drift from what
would actually be sent. `AI_PROVIDER=local` keeps it from spending anything. It
renders the context both compact and pretty-printed, from the same data and with
the same counter, which is what makes the before-and-after columns honest.

With `ANTHROPIC_API_KEY` set it counts tokens through `count_tokens`, which is
exact and free. `HISTORY_TURNS` and `AI_MODEL` change the scenario;
`SEED_MATCHDAYS` changes how much of a season has been played, which moves the
scouting and recent-match blocks. `AI_MODEL` also switches which per-model
tool-use prompt and minimum cacheable prefix the model table is checked against,
which is how the Haiku 4.5 row knows it would not cache.
