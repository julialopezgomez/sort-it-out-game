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

  it('does not show the Ranker-only breakdown', () => {
    render(<RevealView state={state} roomCode="ABCDEF" refresh={vi.fn()} />);

    expect(screen.queryByText('Cómo ha adivinado cada persona')).not.toBeInTheDocument();
  });
});

const rankerState = {
  ...state,
  me: { ...state.me, playerId: 'ranker' },
  turn: { iAmRanker: true, skipped: false },
  reveal: {
    ...state.reveal,
    myComparison: null,
    mySubmitted: false,
    rankerBreakdown: [
      {
        canonicalId: 'f-tofu',
        text: 'Tofu',
        position: 1,
        guesses: [
          { playerId: 'ana', displayName: 'Ana', position: 1, correct: true, submitted: true },
          { playerId: 'ben', displayName: 'Ben', position: 3, correct: false, submitted: true },
        ],
      },
      {
        canonicalId: 'f-cats',
        text: 'Gatos',
        position: 2,
        guesses: [
          { playerId: 'ana', displayName: 'Ana', position: 2, correct: true, submitted: true },
          { playerId: 'ben', displayName: 'Ben', position: null, correct: false, submitted: false },
        ],
      },
    ],
  },
} as unknown as GameStateView;

describe('ranker guess breakdown', () => {
  it('shows one column per guesser and one row per card, in the Ranker’s order', () => {
    render(<RevealView state={rankerState} roomCode="ABCDEF" refresh={vi.fn()} />);

    expect(screen.getByRole('columnheader', { name: 'Ana' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Ben' })).toBeVisible();
    // Each concept appears twice: once in the Ranker's order list, once as a breakdown row.
    expect(screen.getAllByText('Tofu')).toHaveLength(2);
    expect(screen.getAllByText('Gatos')).toHaveLength(2);
  });

  it('marks a correct guess and an incorrect guess with text, not colour alone', () => {
    render(<RevealView state={rankerState} roomCode="ABCDEF" refresh={vi.fn()} />);

    expect(screen.getAllByText('✓').length).toBeGreaterThan(0);
    expect(screen.getAllByText('✕').length).toBeGreaterThan(0);
  });

  it('shows a non-submitter as having no answer, not a wrong guess', () => {
    render(<RevealView state={rankerState} roomCode="ABCDEF" refresh={vi.fn()} />);

    expect(screen.getByText('Sin respuesta')).toBeVisible();
  });
});
