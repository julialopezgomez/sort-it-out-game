import { useTranslation } from 'react-i18next';
import { PlayerList } from '../../components/PlayerList';
import { HostControls } from './HostControls';
import { TurnHeader } from './TurnHeader';
import { useState } from 'react';
import { toGameError, type GameError } from '../../lib/errors';
import { ErrorBanner, Spinner } from '../../components/Feedback';
import type { RoomViewProps } from './shared';

/**
 * Every screen where the current player has nothing to do but wait: the Ranker is
 * choosing, the Ranker is ordering, a Guesser already submitted, a late joiner is sitting
 * out the turn in progress, or the game is quietly moving to the next turn.
 */
export function WaitingView({
  state,
  roomCode,
  refresh,
  offset,
  kind,
}: RoomViewProps & {
  kind: 'preparing' | 'ranker_ordering' | 'submitted' | 'advancing';
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<GameError | null>(null);
  const turn = state.turn;
  const lateJoiner =
    turn !== null && turn !== undefined && !turn.iAmEligibleGuesser && !turn.iAmRanker;

  const heading = () => {
    if (kind === 'advancing') return t('game.advancing');
    if (lateJoiner) return t('waiting.lateJoinTitle');
    if (kind === 'submitted') return t('order.submittedTitle');
    return t('waiting.guesserTitle', { name: turn?.rankerDisplayName ?? '' });
  };

  const body = () => {
    if (kind === 'advancing') return null;
    if (lateJoiner) return t('waiting.lateJoinBody');
    if (kind === 'submitted') {
      return t('order.submittedWaiting', {
        submitted: turn?.submittedCount ?? 0,
        total: turn?.eligibleGuesserCount ?? 0,
      });
    }
    return t('waiting.guesserBody');
  };

  return (
    <div className="space-y-4">
      <TurnHeader state={state} offset={offset} showTimer={kind !== 'advancing'} />

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <section className="card p-5 text-center">
        {kind === 'advancing' ? (
          <Spinner label={heading()} />
        ) : (
          <>
            <h1 className="text-xl">{heading()}</h1>
            <p className="mt-2 text-ink-soft">{body()}</p>
          </>
        )}
      </section>

      {kind !== 'advancing' && (
        <section className="card p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-ink-faint">
            {t('lobby.playerList')}
          </h2>
          <PlayerList
            players={state.players}
            mePlayerId={state.me.playerId}
            showSubmission={kind === 'ranker_ordering' || kind === 'submitted'}
          />
        </section>
      )}

      <HostControls
        state={state}
        roomCode={roomCode}
        refresh={refresh}
        onError={(caught) => setError(toGameError(caught))}
      />
    </div>
  );
}
