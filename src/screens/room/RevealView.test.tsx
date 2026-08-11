import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import type { GameStateView } from '../../lib/schemas';
import { RevealView } from './RevealView';

vi.mock('../../components/Leaderboards', () => ({ Leaderboards: () => null }));
vi.mock('../../components/CooperativeScoreboard', () => ({ CooperativeScoreboard: () => null }));
vi.mock('../../components/Timer', () => ({ Timer: () => null }));
vi.mock('./HostControls', () => ({ HostControls: () => null }));
vi.mock('../../hooks/useCountdown', () => ({ useCountdown: () => 0 }));

const state = {
  game: {
    deadlineAt: null,
    groupPoints: 5,
    gamePoints: 5,
    possiblePoints: 5,
  },
  me: {
    playerId: 'guesser',
    totalScore: 5,
    average: 5,
  },
  turn: {
    iAmRanker: false,
    skipped: false,
  },
  players: [],
  reveal: {
    rankerDisplayName: 'Julia',
    rankerOrder: [
      { canonicalId: 'f-tofu', text: 'Tofu', position: 1 },
      { canonicalId: 'f-cats', text: 'Gatos', position: 2 },
    ],
    myComparison: [
      {
        canonicalId: 'f-tofu',
        text: 'Tofu',
        myPosition: 1,
        rankerPosition: 1,
        correct: true,
      },
      {
        canonicalId: 'f-cats',
        text: 'Gatos',
        myPosition: 2,
        rankerPosition: 2,
        correct: true,
      },
    ],
    myRawScore: 2,
    myAwardedScore: 2,
    myPenaltyApplied: false,
    mySubmitted: true,
    turnGroupPoints: 2,
    turnGamePoints: 2,
    perPlayer: [],
  },
} as unknown as GameStateView;

beforeEach(async () => {
  await i18n.changeLanguage('es');
});

describe('guesser reveal comparison', () => {
  it('shows the Ranker name in the position heading', () => {
    render(<RevealView state={state} roomCode="ABCDEF" refresh={vi.fn()} />);

    expect(screen.getByRole('columnheader', { name: 'Posición de Julia' })).toBeVisible();
    expect(screen.queryByText(/\{\{name\}\}/)).not.toBeInTheDocument();
  });
});
