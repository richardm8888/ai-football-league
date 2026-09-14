# Balancing

Every number in the simulation is a design decision, and most of them are
arbitrary until they are measured. This is what the engine currently produces,
why it is set where it is, and how to change it without breaking the game.

## Where the engine stands

`npm run calibrate` plays 900 matches between six generated squads spanning
reputation 55 to 72 and prints this table. Current output:

| Metric | Value | Realistic range |
| --- | --- | --- |
| Goals per match | 2.71 | 2.6 – 2.9 |
| Home goals | 1.53 | 1.4 – 1.6 |
| Away goals | 1.19 | 1.1 – 1.4 |
| Home win % | 46.4 | 42 – 48 |
| Draw % | 21.7 | 22 – 28 |
| Away win % | 31.9 | 26 – 34 |
| Shots per team | 13.50 | 11 – 14 |
| Shots on target per team | 5.47 | 4 – 5.5 |
| Expected goals per team | 1.41 | 1.1 – 1.6 |
| Passes per team | 481 | 380 – 520 |
| Pass accuracy % | 83.3 | 76 – 85 |
| Fouls per team | 11.58 | 9 – 13 |
| Yellow cards per team | 1.69 | 1.4 – 2.4 |
| Red cards per team | 0.08 | 0.02 – 0.10 |
| Corners per team | 5.78 | 4 – 6 |
| Offsides per team | 2.37 | 1.5 – 3 |
| Saves per team | 4.12 | 2.5 – 4 |
| Home possession % | 50.5 | 49 – 53 |
| Mean player rating | 6.82 | 6.2 – 6.9 |

The draw rate sits just below the range in that sample, because the sample
deliberately includes mismatched fixtures. Between evenly matched sides the split
is 45.8 / 25.5 / 28.7 home / draw / away, which is right.

## The dials that matter

Almost all of the scoreline comes from four numbers in `src/engine/engine.ts`.

**Chance probability** (`0.29`, in `resolveSequence`) sets shots per team. It is
close to linear: halve it and you halve the shots.

**Chance quality** (`rng.range(0.02, 0.178)`, in `chanceQuality`) sets expected
goals per shot, currently about 0.105. Multiply the upper bound to move xG.

**Finishing and keeper multipliers** (in `resolveShot`) set how goals relate to
xG. Their product averages close to 1.0 on purpose, so goals track expected goals
over a season, which is what makes the xG column in a report mean anything.

**Foul probability** (`0.125`, in `maybeFoul`) sets fouls, and through them cards
and free kicks. Card probability per foul is `0.138`, halved again for a player
already booked, which keeps second yellows rare.

Change one at a time and re-run `npm run calibrate`. The engine tests in
`tests/engine/simulation.test.ts` assert the same distributions with wider
tolerances, so they will catch a change that goes badly wrong but will not catch
gentle drift. The calibration script is the instrument; the tests are the alarm.

## Home advantage

`HOME_ADVANTAGE = 1.075` in `src/engine/ratings.ts` lifts the home side's
creation, finishing and build-up by 7.5%, and their defending and pressing by
half that. It produces a home/away goal ratio near 1.25, which matches real
football. This is a single, visible constant on purpose: it is the number most
likely to need adjusting for taste.

## Performance on the day

Each side draws `dayFactor` once per match, normally distributed around 1.0 with
a standard deviation of 0.062, clamped to ±15%, and applied to every rating.

Without it, ability compounds across every channel and a large quality gap
becomes a certainty. This was found by a test: a reputation-82 squad beat a
reputation-52 squad in 150 out of 150 matches. With it, the favourite still wins
overwhelmingly but not always:

| Gap | Favourite wins | Draws | Upsets |
| --- | --- | --- | --- |
| 82 v 52 | 93.3% | 5.0% | 1.7% |
| 74 v 56 | 82.7% | 13.0% | 4.3% |
| 68 v 66 | 43.3% | 23.0% | 33.7% |

The middle row is the spread a generated league actually produces. Raising the
standard deviation makes the league more random and squad building matter less;
lowering it does the reverse.

## Fitness and fatigue

In-match drain is `0.2 + (100 - stamina) / 620 + workRate / 100 × 0.06` per
minute, scaled by the tactical profile's fatigue rate. A well-conditioned player
finishes ninety minutes around 73% fit, so the late-game decline is real without
being absurd.

Weekly recovery works towards a ceiling set by accumulated fatigue:

```
ceiling = 100 - fatigue × 0.32          (floor 58)
fitness = fitness + (ceiling - fitness) × 0.7 + trainingGain - load × 2
```

Fatigue accumulates at `minutes × 0.22` from a match and recovers at
`10 + fatigue × 0.25` a week, which puts a regular starter in equilibrium around
50 fatigue. That is the number to change if the squad feels either too fresh to
need rotation or too worn down to field a side.

Training intensity multiplies tactical gains by 0.55, 1.0, 1.3 or 1.5 and raises
both fatigue and injury risk. The trade-off has to bite, or every manager picks
maximum intensity every week and the decision is not a decision.

## Familiarity

Values run 0 to 100 with a floor of 18 and a ceiling of 99. A club that has never
trained a system sits at 30.

Gains have diminishing returns: `amount × (0.35 + 0.65 × headroom)`, so the last
ten points cost far more than the first ten. Base gains are 7.5 for a primary
training focus, 3.4 for a secondary, and 5.5 for playing the system in a match.
Everything decays 1.3 a week when not worked on. Those four numbers set how long
it takes to bed a system in: roughly eight weeks of focused training to reach 70.

The neutral point is 50. Below it familiarity hurts, above it helps, and
`EXECUTION_BAND = 0.1` caps the swing at ±10% on any channel. That cap is the
single most important balancing decision in the game. Raise it and a drilled
squad starts to beat better players routinely; the test
`familiarity is not a trump card` exists to catch exactly that.

## The cost of change

`analyseTacticalChange` scores a week's changes from 0 to 1 and bands the result:

| Score | Magnitude | Example |
| --- | --- | --- |
| < 0.08 | None | Nothing moved |
| < 0.20 | Minor | Defensive line up one step, tempo up one step |
| < 0.30 | Moderate | Possession to direct; 4-3-3 to 4-2-3-1 |
| ≥ 0.30 | Major | 4-3-3 to 3-5-2; formation, style and pressing at once |

The bands are calibrated against the design brief's own examples. Rebuilding the
back line is a major change on its own, because it changes the defence and both
flanks simultaneously; moving between two back-four shapes is not.

Changing several structural areas in one week costs more than the sum of the
parts, because the players have no fixed reference point left. That is the
`simultaneousStructuralChange` penalty: 0.12 per extra structural change, applied
to every channel.

Disruption compounds but saturates on each channel, so three changes that all
touch build-up do not stack into a catastrophe.

## Gradual transitions

A manager can nominate a formation in training that the side is not yet playing.
Rehearsing 3-5-2 for four weeks while still playing 4-3-3 raises that key before
the switch, so the same change that would have been major arrives as moderate or
less.

This falls out of keying familiarity by setting rather than needing a special
rule, and it is the mechanic that rewards patience. It is asserted directly in
`tests/familiarity/familiarity.test.ts`.

## Squads

`generateSquad` builds 20 players from a club's reputation: two goalkeepers, four
centre-backs, two of each full-back, two defensive midfielders, three central
midfielders, two wingers, an attacking midfielder and three strikers.

The first player in each group is the first choice; later ones carry a depth
penalty of `5 + 3i`, which is what gives every club a genuine problem when
someone is injured. Attributes are drawn normally around the club's quality, plus
eight for the position's key attributes and minus six for the rest. Keepers are
strong at keeping and poor at everything else.

Players aged 21 or under carry 8 to 22 points of growth potential, 22 to 25 carry
3 to 12, and older players are at their ceiling. Past 32 the physical attributes
start to decline.

## Changing any of this

1. Change one number.
2. `npm run calibrate` and check the table above still holds.
3. `npm test` and check nothing that was true has stopped being true.
4. If a test fails, decide honestly whether the test or the model is wrong. Both
   of the balance changes described on this page came from a test failing and the
   model turning out to be the problem.
