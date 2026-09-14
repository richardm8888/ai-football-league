# Decisions

The choices that shaped this build, and the reasoning behind them. Where a
decision cost something, that is recorded too.

## 1. The domain declares its own vocabulary

`src/domain/types.ts` defines every enum as a TypeScript union rather than
importing the generated Prisma enums.

**Why.** It keeps the domain and the match engine free of any dependency on code
generation, which is what lets the bulk of the test suite run with no database
and no build step. It also means the engine could be lifted out and run anywhere.

**Cost.** Two definitions that must stay in step.
`tests/domain/enum-parity.test.ts` asserts they are identical, so drift fails the
build rather than appearing as a mysterious runtime error.

## 2. One command surface, and the AI shares it

Every change to a club's competitive state parses against a schema in
`src/domain/schemas.ts` and flows through `saveMatchPlan` or `saveTrainingPlan`.
The AI has no privileged path.

**Why.** It means the AI layer does not have to be trusted. The only thing a
model can produce is a value the domain already understands, checked against the
real squad, and a human still has to approve it. Safety comes from the shape of
the system rather than from the model behaving well.

It also means the AI and a form cannot diverge. There is no second code path to
keep in sync, and no class of bug where a proposal is applied by a route the
validation does not cover.

## 3. Familiarity per dimension, never one cohesion number

Tracked separately for formation, playing style, pressing, defensive
organisation, build-up, transition and set pieces, each keyed by the specific
setting practised, each driving one execution channel.

**Why.** A single cohesion penalty is unreadable and unfair. If a manager is told
their team is "82% cohesive" they cannot act on it. If they are told pressing
familiarity is 40 and the press will be mistimed, they can train it. It also
makes the model honest: a side that has not practised pressing presses badly and
passes normally.

The per-setting keying pays for itself twice. It gives the interface the numbers
the brief asked for — "high pressing: 68" — and it makes gradual transitions fall
out of the model rather than needing a special rule.

## 4. Familiarity is capped at ±10%

`EXECUTION_BAND = 0.1` in `src/domain/familiarity/index.ts`.

**Why.** The brief was explicit that consistency must not be unbeatable, and it
is the easiest thing in a game like this to get wrong. A cap is a blunt
instrument but it is a legible one: you can read the constant and know the worst
case. `familiarity is not a trump card` asserts that a perfectly drilled weak
squad still loses to a stronger one, and that a drilled side stays beatable.

## 5. Training can rehearse a shape you are not playing

The training plan carries an optional `targetFormation`.

**Why.** Without it, "gradual transition" is not expressible. The only way to
raise familiarity with 3-5-2 would be to play 3-5-2, which means taking the full
cost in week one either way, and a manager who plans ahead is indistinguishable
from one who does not. With it, four weeks of rehearsal turns a major change into
a moderate one, and patience is a strategy.

This required a schema field and a migration, which is a real cost for one
mechanic. It was worth it: this is the mechanic the brief cares most about.

## 6. A performance level for the day

Each side draws a per-match factor around 1.0.

**Why.** A test caught it: a reputation-82 squad beat a reputation-52 squad 150
times out of 150. Ability compounds across every channel, and without a source of
team-level variance a quality gap becomes arithmetic. Real football always leaves
room for an upset. The factor is small and symmetric, so the favourite still wins
overwhelmingly.

This is a good example of a test earning its keep by disproving something the
model implied but nobody had checked.

## 7. A deterministic local coach, not a stub

`src/ai/providers/local.ts` is a real rule-based assistant: it parses the
manager's instruction, reads the squad and the public opponent profile, picks a
shape, names a side, recommends training and states the risks.

**Why.** Three jobs at once. The game is completely playable with no provider
account, which matters for a private league of friends who may not want to pay
for one. It is the fallback when a provider times out or returns something
unparseable, so a provider outage never stops a matchday. And it makes every AI
workflow testable without a network call, which is why `tests/ai` runs in
seconds and is deterministic.

The cost is that it is a second thing to maintain. That is accepted: a stub would
have made the fallback path untested, and the fallback path is exactly the one
that matters when something is broken.

## 8. The engine is the only authority, structurally

`src/services` imports nothing from `src/ai`. The dependency direction makes it
impossible for the simulator to consult a model.

**Why.** "The LLM must not decide results" is easy to state and easy to violate
by accident six months later. Making it a property of the module graph means it
cannot be violated without someone deliberately adding an import that reviewers
would see.

## 9. Scrypt and opaque session tokens, no auth library

Passwords are hashed with Node's built-in scrypt; sessions are random tokens
stored hashed.

**Why.** A private league of eight people does not need federated identity,
social login or account recovery flows. The whole of `src/services/auth.ts` is
readable in one sitting, which for security code is worth more than features
nobody will use. Storing the session token hashed means a database leak does not
hand over live sessions.

**Cost.** No password reset, no social login. Both are straightforward to add if
the league ever wants them.

## 10. No drag-and-drop anywhere

The tactics screen is tap-to-select: tap a shirt, choose a player from a list
ordered by suitability.

**Why.** The brief asked for it, and it is right. Drag-and-drop on touch is
unreliable, impossible with assistive technology, and painful one-handed on a
bus. A list of players sorted by how well they suit the slot, each with a
suitability badge, is more informative than a pitch you have to drag things
around anyway.

## 11. Domain validation runs in the browser too

The tactics editor imports the same `validateMatchPlan` the server calls.

**Why.** A manager should see "this player is makeshift at left-back" while they
are choosing, not after they submit. Because the domain is pure it runs in both
places from one implementation, so the two can never disagree.

The server revalidates on every save regardless. The client copy is feedback, not
trust, and the comment in the file says so.

## 12. Reports are assembled from facts, never written freely

`buildMatchFacts` extracts a structured object from the simulation;
`narrateMatch` assembles sentences only from numbers in that object.

**Why.** A match report that invents an explanation is worse than no report,
because managers will act on it. Grounding the narrative in recorded events means
every claim can be traced to a number. It is also the contract for the AI layer:
it is handed these facts rather than asked to explain a result it cannot see.

An end-to-end test asserts the published report matches the simulation number for
number.

## 13. Deadline passing commits every outstanding plan

Advancing a matchday to LOCKED locks every plan that has not been locked.

**Why.** Found by testing the real interface: an administrator could advance past
the point where plans could be edited, leaving clubs unable to either change or
commit. The fix matches how a deadline actually works — what you had at the
whistle is what you play — and it removes the dead end entirely.

## 14. PostgreSQL, with a binary fallback for tests

The app targets PostgreSQL, and `scripts/local-postgres.sh` brings a cluster up
from the PostgreSQL binaries where Docker is not available.

**Why.** Postgres is the right database and Docker Compose is the right local
setup. But the test suite should not be unrunnable on a machine without a Docker
daemon, and the end-to-end test is only meaningful against real persistence.
Forty lines of shell buys a suite that runs anywhere the binaries exist.

## 15. Mobile checked by machine, not by eye

`scripts/mobile-check.mjs` drives every screen at five viewport sizes and fails
on horizontal overflow, touch targets under 44px, or any page error.

**Why.** "Mobile-first" decays silently. A grid without an explicit base column
count, a table cell without `min-width: 0`, a link that is only 16px tall — all
of them look fine on a laptop and are wrong on a phone. Three real defects were
found and fixed this way, including a grid that pushed the reports page 52px
sideways on a 320px screen.

## Known limitations

- **Squad depth is fixed at 20 players.** Enough for rotation and injuries;
  a long injury crisis in one position can still leave a makeshift selection,
  which is realistic but occasionally frustrating.
- **Substitutions are planned, not live.** A manager sets conditional
  substitutions before kick-off and the engine applies them. There is no live
  match view to intervene in, which the brief deferred.
- **One season at a time.** The model supports multiple seasons per league, but
  there is no close-season: no contract expiry, no ageing rollover, no transfers.
- **Scouting is inference only.** There are no scouts, no reports on individual
  opposition players, and no hidden information to uncover — only what can be
  derived from published match data.
- **Two development-time advisories remain in `npm audit`,** both in transitive
  dependencies of the latest Next 15 and Vitest 3 releases, and both affecting
  development servers rather than production. Clearing them requires major
  upgrades that were out of scope.
