# Architecture

## The shape of it

Five layers, each depending only on the ones above it.

```
  Domain        pure rules, types, schemas, validation, familiarity, reporting
     ↑
  Engine        the match simulation; depends on domain types only
     ↑
  Services      persistence and orchestration; the only layer that touches the database
     ↑
  AI            provider abstraction; consumes services, produces proposals
     ↑
  App           Next.js pages, server actions, components
```

Two rules keep this honest.

**The engine never reaches sideways.** It imports domain types and nothing else.
It performs no I/O, holds no clock, and takes every random number from a seeded
generator passed in with its input. That is what makes a result reproducible.

**The AI layer sits above the services, not inside them.** Nothing in
`src/services` imports anything from `src/ai`. The simulator has no way to call a
model even by accident, and removing the whole AI directory would leave a
complete, playable game.

## Domain

`src/domain` holds the rules of football as this game understands them, with no
dependency on the database client or on Next.js. It is all pure functions and
data, which is why the bulk of the test suite needs no database.

The layer declares its own vocabulary in `types.ts` rather than importing the
generated Prisma enums. That keeps the pure layers independent of code
generation, at the cost of a risk of drift, which `tests/domain/enum-parity.test.ts`
removes by asserting the two are identical.

`schemas.ts` is the command surface. Every change to a club's competitive state —
whether typed into a form or proposed by a model — must parse against one of
these schemas. There is no other way in. That single decision is what makes the
AI layer safe: it does not need to be trusted, because the only thing it can
produce is a value the domain already understands.

Validation returns two kinds of issue. Errors block submission: a player who is
not in the squad, an injured starter, a goalkeeper played outfield, instructions
that contradict each other. Warnings inform but permit: a player out of position,
a thin bench, a tired squad, an unusual combination. The distinction matters
because a manager should be free to do something odd on purpose.

## The match engine

A conventional, event-based simulation. The match is a chain of possession
sequences; each is resolved through build-up, pressing, turnover, transition,
chance creation and finishing, with fouls, cards, set pieces, injuries,
substitutions and in-match tactical changes layered on a minute clock.

Ratings are computed once per team per refresh from the eleven on the pitch. Each
player's contribution to a channel — defending, pressing, build-up, creation,
finishing, width, transition, aerial — is their ability weighted by the band they
occupy and the emphasis of the role they have been given. A ball-winning
midfielder pushes weight into pressing; a deep-lying playmaker pushes it into
build-up. Nothing about this is random.

Tactical instructions become a `TacticalProfile`: possession weight, directness,
sequence rate, build-up success, chance rate and quality, defensive solidity,
press aggression, foul rate, offside rate, counter threat and vulnerability,
fatigue rate, set-piece threat, crossing share and card risk. The engine rolls
against those, not against a single team strength number.

Each match also draws a performance level for the day per side. Without it a
large quality gap becomes a mathematical certainty, which no real league is.

Every result is stored with its seed, the engine version, and a snapshot of the
exact input it was given, so any result can be re-derived and audited.

## Tactical familiarity

The mechanic the game is built around, and the one most easily done badly.

Familiarity is never a single cohesion number. It is tracked per dimension and
keyed by the specific setting practised, so a club knows "high pressing" to 68
and "low block" to 30 as separate facts. Each dimension then drives one execution
channel in the engine:

| Dimension | What it degrades when low |
| --- | --- |
| Pressing | Press coordination and timing, and the fouls a mistimed press concedes |
| Build-up | Passing security under pressure, and turnovers in your own third |
| Defensive organisation | Compactness, and the gaps that open between units |
| Formation and roles | Positional quality across the side |
| Transition | Counter-attack reliability and defensive recovery |
| Set pieces | Delivery and movement quality |

Every channel modifier is clamped to a narrow band. Familiarity buys reliability,
not dominance, and the tests assert that it cannot rescue a much weaker squad and
leaves a perfectly drilled side beatable.

Because formation and style familiarity are keyed by setting, a gradual
transition falls out of the model rather than needing special handling: a
manager who nominates a shape in training for several weeks arrives at the switch
with that key already high. Switching on matchday is a major change; switching
after four weeks of rehearsal is not.

## Services

`src/services` is the only layer that touches the database. It loads stored rows
into the shapes the pure layers expect, applies domain rules, and writes the
results back.

`plans.ts` is the single door into a club's competitive decisions. Manual edits
and approved AI proposals both land in `saveMatchPlan`, which checks the matchday
phase, parses against the schema, validates against the current squad, computes
the tactical change analysis, and writes an audit entry. Locking revalidates from
scratch, because fitness and injuries move during the week.

`simulation.ts` runs a matchday in the order a real week runs: training first, so
it affects the match; then the fixtures; then form, morale, injuries,
suspensions, familiarity, the table and the reports. A training-ground injury to
a locked starter promotes the closest available replacement rather than blocking
the fixture.

## The AI layer

An `AiProvider` interface with two implementations.

The **Anthropic provider** constrains the model to a single tool whose schema
mirrors the domain commands, so the only thing it can emit is a typed proposal.
Timeouts, bounded retries with backoff, and rate-limit handling live here.

It also owns what a request costs. The system prompt and the tool schema are the
only part of a request that never varies, so both carry a cache breakpoint and
are billed at a tenth on a repeat within five minutes. Because the prefix says
nothing about any particular club, it is the same bytes for the whole league and
any manager's request warms it for all of them. The context blocks are
serialised compactly for the same reason: indentation in the squad block alone
was about a third of the context. What each call actually cost is recorded on
the `AiDecision` row it produced, which is also the only way a cache that has
quietly stopped matching would ever be noticed.

The **local coach** is a deterministic, rule-based assistant that reads the
manager's instruction, the squad and the public opponent profile and returns the
same kind of structured proposal. It exists for three reasons: the game must be
fully playable with no provider account, it is the fallback when a provider
fails, and it makes the AI workflow testable without a network call.

`vocabulary.ts` is the other half of the local coach: the phrasings the interface
advertises, kept beside the intents that read them. Every screen that shows a
manager an example draws from it, and a test puts each one through the coach, so
the guidance cannot quietly drift from what the parser understands.

`context.ts` is the privacy boundary. It loads the manager's own club in full and
the opponent only as published results and labelled estimates. An opponent's
squad, plans, training and conversations are not loaded, so they cannot leak.

Four things stand between a model and the game state:

1. It can only answer through a typed tool schema.
2. Whatever comes back is parsed; anything outside the schema is stripped.
3. What survives is revalidated against the real squad and the tactical rules.
4. What it writes is a draft, through the same plan service a manual edit uses,
   described back to the manager line by line and reversible in one tap. The
   manager's instruction is the authorisation; locking the plan before the
   deadline is the commitment.

Untrusted text — club names, player names, notes, the manager's own message — is
escaped and wrapped in labelled data blocks that the system prompt defines as
information rather than instruction. That is defence in depth; the typed tool
surface is the actual control.

## The web application

Next.js App Router. Pages are server components that load through the services;
mutations are server actions that re-establish who the caller is and what they
own. The client is never trusted with authorisation, and the matchday phase is
read from the database rather than accepted from a form.

The tactics screen runs the same pure domain validation in the browser that the
server enforces on save, so warnings about unfamiliar systems, out-of-position
players and the cost of a tactical change appear while the manager edits. The
server revalidates regardless.

Every submission reports itself where the control is. The button settles into
what it did, a line above it says what happened and when, and a refusal appears
against the control that was refused — none of it in an alert at the top of the
page, which on a phone is several screens away from the thumb. The settled state
is derived from a fingerprint of the plan the server stored rather than from a
timer, so "Saved" cannot outlive the fact it describes.

A first-run walkthrough introduces the weekly loop once per user, recorded as
`User.tourSeenAt` and reachable afterwards from the help button in the top bar.

The interface is mobile-first in the literal sense: it was built at 320px and
allowed to grow. Bottom navigation, cards instead of dense tables, tap-to-select
instead of drag-and-drop, 44px minimum touch targets, and inputs at 16px so iOS
does not zoom the page on focus. `npm run check:mobile` walks every screen at five
viewport sizes and fails on horizontal overflow, undersized targets or page
errors.

## Testing

| Suite | Needs a database | What it covers |
| --- | --- | --- |
| `tests/domain` | no | Vocabulary parity, fixture generation, every validation rule, phase gates, change descriptions, and the layering rules themselves |
| `tests/engine` | no | Determinism, statistical realism, home advantage, quality, fitness, tactical effects, reporting accuracy |
| `tests/familiarity` | no | Growth, decay, targeted disruption, change costs, gradual transitions, bounded effect |
| `tests/ai` | yes | Structured output, rejection of invalid proposals, privacy, inability to touch results, failure fallback, injection, fairness, and that applying an instruction is described and reversible |
| `tests/e2e` | yes | The complete matchday walk-through against real persistence, and a manager's first run |

`scripts/calibrate.ts` is a balancing tool rather than a test: it plays 900
matches and prints the statistical profile against the range each metric should
fall in. Run it after any change to the engine.
