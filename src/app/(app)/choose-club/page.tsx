import { redirect } from 'next/navigation';
import { listClubChoices } from '@/services/league';
import { loadPageContext } from '@/services/page-context';
import { ClubChooser } from '@/components/club-chooser';
import { Alert, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ChooseClubPage() {
  const context = await loadPageContext();
  if (context.club) redirect('/club');

  const choices = await listClubChoices(context.league.id);
  const available = choices.filter((c) => c.available);

  return (
    <>
      <PageHeader title="Choose your club" subtitle={context.league.name} />

      {choices.length === 0 ? (
        <Alert tone="warn" title="The season has not started yet">
          <p>There are no clubs to choose from until an administrator starts the season.</p>
          <p className="mt-2">Share this invite code with anyone else joining:</p>
          <p className="mt-1 font-mono text-lg tracking-[0.2em] text-brand-400">{context.league.inviteCode}</p>
        </Alert>
      ) : available.length === 0 ? (
        <Alert tone="warn" title="Every club is taken">
          <p>Ask the league administrator to free one up, or to add you to a club directly.</p>
        </Alert>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-400">
            You can see what each club is known for, how well thought of it is and how it is
            doing. You cannot see anyone&rsquo;s squad, and neither can they see yours.
          </p>
          <ClubChooser leagueId={context.league.id} choices={choices} />
        </>
      )}
    </>
  );
}
