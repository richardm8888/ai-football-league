import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import {
  GOALKEEPING_ATTRIBUTES, MENTAL_ATTRIBUTES, PHYSICAL_ATTRIBUTES, TECHNICAL_ATTRIBUTES,
} from '@/domain/types';
import { loadPlayerFamiliarity, loadSquad } from '@/services/club';
import { ROLE_DEFINITIONS } from '@/domain/tactics/roles';
import { requireClubContext } from '@/services/page-context';
import { Badge, Card, CardTitle, Empty, Meter, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function PlayerPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const context = await requireClubContext();

  const squad = await loadSquad(context.club.id);
  const player = squad.find((p) => p.id === playerId);
  // Authorisation: private player detail belongs to the owning manager only.
  if (!player) notFound();

  const [familiarity, performances] = await Promise.all([
    loadPlayerFamiliarity(context.club.id),
    prisma.playerMatchPerformance.findMany({
      where: { playerId },
      orderBy: { match: { simulatedAt: 'desc' } },
      take: 5,
      include: { match: { include: { fixture: { include: { homeClub: true, awayClub: true } } } } },
    }),
  ]);
  const playerFamiliarity = familiarity[playerId] ?? { roles: {}, positions: {} };

  const groups: Array<[string, readonly string[]]> = [
    ['Technical', TECHNICAL_ATTRIBUTES],
    ['Mental', MENTAL_ATTRIBUTES],
    ['Physical', PHYSICAL_ATTRIBUTES],
  ];
  if (player.primaryPosition === 'GK') groups.push(['Goalkeeping', GOALKEEPING_ATTRIBUTES]);

  return (
    <>
      <Link href="/squad" className="mb-3 inline-block text-sm text-brand-400">← Squad</Link>
      <PageHeader
        title={player.name}
        subtitle={`#${player.shirtNumber} · ${player.primaryPosition}${player.secondaryPositions.length ? ` / ${player.secondaryPositions.join(', ')}` : ''} · ${player.age} years · ${player.preferredFoot.toLowerCase()} footed`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone="good">Overall {player.overall}</Badge>
        <Badge tone="info">Potential {player.potential}</Badge>
        <Badge>{player.personality}</Badge>
        <Badge>Contract to {player.contractUntil}</Badge>
        {player.injury !== 'NONE' && (
          <Badge tone="bad">{player.injuryDescription} · {player.injuryWeeksLeft}w</Badge>
        )}
        {player.suspensionMatches > 0 && <Badge tone="warn">Suspended {player.suspensionMatches}</Badge>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardTitle>Condition</CardTitle>
          <div className="space-y-3">
            <Meter label="Fitness" value={player.fitness} />
            <Meter label="Match sharpness" value={player.matchSharpness} />
            <Meter label="Form" value={player.form} />
            <Meter label="Morale" value={player.morale} />
            <Meter label="Confidence" value={player.confidence} />
            <Meter label="Fatigue" value={100 - player.fatigue} hint={`Carrying ${Math.round(player.fatigue)} units of fatigue.`} />
          </div>
        </Card>

        <Card>
          <CardTitle>This season</CardTitle>
          <dl className="grid grid-cols-3 gap-3 text-center">
            {[
              ['Apps', player.appearances], ['Goals', player.goals], ['Assists', player.assists],
              ['Minutes', player.minutes], ['Avg rating', player.averageRating || '—'],
              ['Cards', `${player.yellowCardsSeason}Y ${player.redCardsSeason}R`],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl bg-pitch-850 p-2.5">
                <dt className="text-[11px] uppercase tracking-wide text-ink-500">{label}</dt>
                <dd className="mt-0.5 text-lg font-bold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {groups.map(([label, keys]) => (
          <Card key={label}>
            <CardTitle>{label}</CardTitle>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {keys.map((key) => (
                <li key={key} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-ink-300 capitalize">
                    {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
                  </span>
                  <span className={`font-semibold tabular-nums ${
                    player.attributes[key as keyof typeof player.attributes] >= 75 ? 'text-brand-400'
                      : player.attributes[key as keyof typeof player.attributes] >= 55 ? 'text-ink-50' : 'text-ink-500'
                  }`}
                  >
                    {player.attributes[key as keyof typeof player.attributes]}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ))}

        <Card>
          <CardTitle>Role familiarity</CardTitle>
          {Object.keys(playerFamiliarity.roles).length === 0 ? (
            <Empty>No role has been drilled yet.</Empty>
          ) : (
            <div className="space-y-3">
              {Object.entries(playerFamiliarity.roles)
                .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                .slice(0, 6)
                .map(([role, value]) => (
                  <Meter
                    key={role}
                    label={ROLE_DEFINITIONS[role as keyof typeof ROLE_DEFINITIONS]?.label ?? role}
                    value={value ?? 0}
                  />
                ))}
            </div>
          )}
        </Card>

        <Card className="sm:col-span-2">
          <CardTitle>Recent performances</CardTitle>
          {performances.length === 0 ? (
            <Empty>No appearances yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {performances.map((p) => {
                const fixture = p.match.fixture;
                const opponent = fixture.homeClubId === context.club.id ? fixture.awayClub.name : fixture.homeClub.name;
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-pitch-850 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{opponent}</span>
                      <span className="block text-xs text-ink-500">
                        {p.minutesPlayed}′ · {p.position} · {p.goals}g {p.assists}a
                        {p.yellowCard ? ' · booked' : ''}{p.redCard ? ' · sent off' : ''}
                      </span>
                    </span>
                    <span className={`rounded-lg px-2.5 py-1 text-sm font-bold tabular-nums ${
                      p.rating >= 7.5 ? 'bg-brand-600/20 text-brand-400'
                        : p.rating >= 6.3 ? 'bg-pitch-800 text-ink-100' : 'bg-danger-500/15 text-danger-400'
                    }`}
                    >
                      {p.rating.toFixed(1)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
