import { familiarityFor } from '@/domain/familiarity';
import { canEditPlans } from '@/domain/validation';
import { loadClubFamiliarity, loadSquad } from '@/services/club';
import { getOrCreateMatchPlan, getOrCreateTrainingPlan, toTrainingInput } from '@/services/plans';
import { requireClubContext } from '@/services/page-context';
import { TrainingEditor, type TrainingPlayer } from '@/components/training-editor';
import { Alert, CoachFirst, ManualOverride, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function TrainingPage() {
  const context = await requireClubContext();

  if (!context.matchday) {
    return (
      <>
        <PageHeader title="Training" />
        <Alert tone="warn" title="No active matchday">Training opens with the next matchday.</Alert>
      </>
    );
  }

  const [squad, familiarity, trainingRow] = await Promise.all([
    loadSquad(context.club.id),
    loadClubFamiliarity(context.club.id),
    getOrCreateTrainingPlan(context.club.id, context.matchday.id),
  ]);

  const matchPlan = context.fixture
    ? await getOrCreateMatchPlan(context.fixture.id, context.club.id, squad)
    : null;
  const values = matchPlan
    ? familiarityFor(familiarity, matchPlan.tactics)
    : { formation: 30, pressing: 30, buildUp: 30, defensiveOrganisation: 30, transition: familiarity.TRANSITION, setPieces: familiarity.SET_PIECES };

  const players: TrainingPlayer[] = squad.map((p) => ({
    id: p.id,
    name: p.name,
    primaryPosition: p.primaryPosition,
    secondaryPositions: p.secondaryPositions,
    fitness: p.fitness,
    injured: p.injury !== 'NONE',
    injuryDescription: p.injuryDescription,
    suspended: p.suspensionMatches > 0,
  }));

  return (
    <>
      <PageHeader
        title="Training"
        subtitle={`Matchday ${context.matchday.number} · what the week on the grass buys you`}
      />
      <CoachFirst
        what="Say what the side needs to work on this week. Your staff set the focus and the intensity, and weigh the fitness cost against the gain."
        examples={[
          'We keep getting pressed into mistakes — work on playing out from the back.',
          'Start rehearsing three at the back, we will switch to it in a few weeks.',
          'Legs looked heavy last week. Keep it light.',
        ]}
      />

      <ManualOverride label="Set it manually instead">
      <TrainingEditor
        clubId={context.club.id}
        matchdayId={context.matchday.id}
        editable={canEditPlans(context.matchday.phase, trainingRow.status as never).ok}
        initialPlan={toTrainingInput(trainingRow)}
        players={players}
        status={trainingRow.status}
        currentFormation={matchPlan?.tactics.formation ?? 'F_4_3_3'}
        familiarity={{
          formation: values.formation,
          pressing: values.pressing,
          buildUp: values.buildUp,
          defensiveOrganisation: values.defensiveOrganisation,
          transition: familiarity.TRANSITION,
          setPieces: familiarity.SET_PIECES,
        }}
      />
      </ManualOverride>
    </>
  );
}
