import { loadClubFamiliarity, loadSquad } from '@/services/club';
import { getOrCreateMatchPlan, getPreviousPlayedPlan } from '@/services/plans';
import { requireClubContext } from '@/services/page-context';
import { canEditPlans, canLockPlan } from '@/domain/validation';
import { TacticsEditor } from '@/components/tactics-editor';
import type { EditorPlayer } from '@/components/tactics-editor-types';
import { Alert, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function TacticsPage() {
  const context = await requireClubContext();

  if (!context.fixture || !context.matchday) {
    return (
      <>
        <PageHeader title="Tactics" />
        <Alert tone="warn" title="No fixture to prepare for">
          There is no scheduled match at the moment. Tactics open again when the next matchday does.
        </Alert>
      </>
    );
  }

  const [squad, familiarity, plan, previousPlan] = await Promise.all([
    loadSquad(context.club.id),
    loadClubFamiliarity(context.club.id),
    getOrCreateMatchPlan(context.fixture.id, context.club.id),
    getPreviousPlayedPlan(context.club.id),
  ]);

  const players: EditorPlayer[] = squad.map((p) => ({
    id: p.id,
    name: p.name,
    lastName: p.lastName,
    shirtNumber: p.shirtNumber,
    primaryPosition: p.primaryPosition,
    secondaryPositions: p.secondaryPositions,
    attributes: p.attributes,
    overall: p.overall,
    fitness: p.fitness,
    form: p.form,
    injured: p.injury !== 'NONE',
    injuryDescription: p.injuryDescription,
    suspended: p.suspensionMatches > 0,
  }));

  const editable = canEditPlans(context.matchday.phase, plan.status).ok;
  const lockable = canLockPlan(context.matchday.phase).ok;

  return (
    <>
      <PageHeader
        title="Tactics"
        subtitle={`Matchday ${context.matchday.number} · ${context.fixture.venue === 'HOME' ? 'vs' : 'away to'} ${context.fixture.opponentName}`}
      />
      <TacticsEditor
        fixtureId={context.fixture.id}
        clubId={context.club.id}
        opponentName={context.fixture.opponentName}
        venue={context.fixture.venue}
        phase={context.matchday.phase}
        planStatus={plan.status}
        editable={editable}
        lockable={lockable && editable}
        initialTactics={plan.tactics}
        initialLineup={plan.lineup}
        players={players}
        familiarity={familiarity}
        previousPlan={previousPlan}
      />
    </>
  );
}
