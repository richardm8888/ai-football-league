# AI Football League

A private, multiplayer football management game. Fantasy Football and Football
Manager combined for the modern world.

Six to eight friends each take charge of a fictional club, choosing which one on
what any manager can see about it: what it is known for, how well thought of it
is, and how it is doing. You set the training, pick the side, choose how the team
plays, and lock it in before the deadline. Every fixture is then simulated by a
conventional match engine, and the whole league gets the same report.

Each manager has an AI coaching staff, and that is how you manage. You tell them
what you want in plain English; they read your squad and what the opposition have
actually been doing, then pick the side, set the shape and set the training, and
tell you exactly what they changed. Overrule any of it by hand if you would
rather. They never decide a result.

## The idea

Three rules shape everything here.

**The match engine is the only thing that decides a match.** It is a
conventional, event-based simulation. It takes no dependency on any AI provider,
performs no I/O, and draws every random number from a seeded generator, so a
result can be replayed exactly and audited afterwards.

**The human manager decides.** You tell the staff what you want and they set it
up — the instruction is the decision, not a form you fill in afterwards. Every
change is parsed against a typed schema, revalidated against your real squad and
the tactical rules, listed back to you in plain words, and undoable in one tap.
It lands as a draft: locking in before the deadline is still your own act, and
there is no channel through which a model can write anything else.

**Tactical identity is worth something.** A side that trains and plays a coherent
system becomes more reliable at it. Familiarity is tracked separately for shape,
style, pressing, defensive organisation, build-up, transitions and set pieces,
and each one degrades the specific part of the game it belongs to rather than
applying a blanket penalty. It buys consistency, not dominance: a perfectly
drilled weak squad still loses to a much stronger one.

## Running it

You need Node 22 and PostgreSQL 16.

```bash
git clone https://github.com/richardm8888/ai-football-league
cd ai-football-league
npm install

cp .env.example .env
# Set SESSION_SECRET. Generate one with: openssl rand -hex 32

docker compose up -d db        # or: npm run pg:start
npm run db:deploy              # apply migrations
SEED_MATCHDAYS=2 npm run db:seed
npm run dev
```

Then open http://localhost:3000 and sign in as any seeded manager, for example
`alex@example.com` with the password `kickoff-2026`.

Without an `ANTHROPIC_API_KEY` the app runs a deterministic local coach instead.
Every AI workflow stays usable: it reads your instruction, your squad and the
public opponent profile, and returns the same kind of structured, validated
proposal. Set the key to use a language model instead.

### Deployment

Merging a pull request into `main` deploys it. The tests run, the image is
built and tagged with the commit, and the droplet pulls it, migrates, swaps the
container and checks that the new build actually answers before keeping it —
rolling back on its own if it does not.

The database is DigitalOcean managed Postgres rather than a container, so
nothing on the droplet stores data. `docs/DEPLOY.md` covers the one-time setup,
how to roll back, and how to deploy by hand if GitHub is unavailable.

To run the whole thing locally in containers instead, `docker compose up`
brings up a database and the app together.

## The week

There is one deadline a week and one thing to do before it: set your training,
your shape and your side, in whatever order suits you, then lock in.

| Phase | What happens |
| --- | --- |
| Open | Prepare however you like, then lock in. The only phase you act in. |
| Locked | Every outstanding plan is committed as it stands. |
| Simulation | Fixtures are played. No AI is involved. |
| Post match | Results, statistics and reports are published to the league. |
| Complete | The matchday is finished and the next one opens. |

**The league runs at the pace of its slowest human, and no slower.** The matchday
plays the moment the last manager locks in, so a group who are all online can get
through several weeks in an evening, and nobody has to be awake to referee it. If
someone goes quiet, the deadline sweeps their plan up and the league moves on.

Clubs nobody manages are never something the league waits for: they are frozen on
the plan their coaching staff would have picked.

The week used to be split into five phases before the deadline. They gated
nothing — the same actions were legal in all of them — and each one was another
place a single manager who was away could stall everyone else, so they are gone.

Training runs first, so the week on the grass moves fitness, sharpness and
familiarity before the match is played. Form, morale, injuries, suspensions and
the table are brought up to date afterwards.

## What you can see

Three levels, enforced in the domain rather than the interface.

**Public.** Results, the table, match statistics, formations used, events, player
performances, public injuries and suspensions, and every published report.

**Private.** Your AI conversations, your training plan, your unsubmitted tactics,
your squad's internal detail. An opponent's plan for a match that has not been
played is private to them.

**Scouted.** What you can infer about an opponent from published data. It is
always labelled as an estimate, always cites the statistic it came from, and
carries a confidence level based on how many matches you have seen.

## Layout

```
src/domain/      Pure rules. No I/O, no database, no AI.
  types.ts         The vocabulary, independent of the database client
  schemas.ts       Zod command schemas: the only way to change a club's state
  tactics/         Formations, roles, suitability, selection
  validation/      Blocking errors and advisory warnings
  familiarity/     Tactical familiarity, change cost, execution modifiers
  weekly/          Training effects, injuries, match aftermath
  reports/         Match facts and league roundups, built from simulation data
  visibility/      Public, private and scouted information
src/engine/      The match engine. Seeded, pure, and the only authority on results.
src/ai/          Provider abstraction, context building, injection defence
src/services/    Persistence and orchestration
src/app/         Next.js App Router pages and server actions
src/components/  Mobile-first UI
tests/           Domain, engine, familiarity, AI and end-to-end suites
deploy/          The script the droplet runs to swap builds
```

Read `docs/ARCHITECTURE.md` for how the layers fit together,
`docs/DECISIONS.md` for why, `docs/BALANCING.md` for the numbers behind the
simulation and how to retune them, and `docs/DEPLOY.md` for how a merge becomes
a running container.

## Development

```bash
npm run dev            # development server
npm test               # 194 tests: domain, engine, familiarity, AI, end to end
npm run typecheck      # strict TypeScript, no emit
npm run calibrate      # run 900 matches and print the statistical profile
npm run check:mobile   # walk every screen at five viewport sizes
npm run db:migrate     # create a migration after a schema change
```

`npm test` needs a database. `npm run pg:start` will bring one up on port 5433
using the PostgreSQL binaries directly, which is useful where Docker is not
available. Point `TEST_DATABASE_URL` somewhere else if you prefer.

The match engine is calibrated against real football. `npm run calibrate` prints
goals, shots, expected goals, possession, passing, discipline and ratings
alongside the range each should fall in.

## Not built yet

Deliberately deferred so the weekly loop could be finished properly: transfers
and contracts, club finances, youth academies, multiple divisions, promotion and
relegation, live match viewing, and specialised AI staff beyond the single
coaching interface. The domain model leaves room for all of them.
