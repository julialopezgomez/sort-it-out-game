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
    // Deliberately out of the Ranker's order: this guesser placed the Ranker's #2 card
    // first and the Ranker's #1 card second, getting both wrong.
    myComparison: [
      {
        canonicalId: 'f-cats',
        text: 'Gatos',
        myPosition: 1,
        rankerPosition: 2,
        correct: false,
      },
      {
        canonicalId: 'f-tofu',
        text: 'Tofu',
        myPosition: 2,
        rankerPosition: 1,
        correct: false,
      },
    ],
    myRawScore: 0,
    myAwardedScore: 0,
    myPenaltyApplied: false,
    mySubmitted: true,
    turnGroupPoints: 0,
    turnGamePoints: 2,
    perPlayer: [],
    fullBreakdown: null,
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

  it('orders rows by the Ranker’s position, not the Guesser’s own guess', () => {
    render(<RevealView state={state} roomCode="ABCDEF" refresh={vi.fn()} />);

    const rows = screen.getAllByRole('row').filter((row) => row.querySelector('td'));
    // Tofu is the Ranker's #1, so it must appear first even though this Guesser
    // guessed it second.
    expect(rows[0]).toHaveTextContent('Tofu');
    expect(rows[1]).toHaveTextContent('Gatos');
  });

  it('does not show the full breakdown when there is only one Guesser', () => {
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
    fullBreakdown: [
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

describe('the full guess breakdown', () => {
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

  it('totals each guesser’s correct count in a footer row', () => {
    render(<RevealView state={rankerState} roomCode="ABCDEF" refresh={vi.fn()} />);

    expect(screen.getByRole('rowheader', { name: 'Total' })).toBeVisible();
    // Ana was correct on both cards; Ben was wrong on one and never answered the other.
    expect(screen.getByText('2/5')).toBeVisible();
    expect(screen.getByText('0/5')).toBeVisible();
  });
});

const guesserWithFullBreakdown = {
  ...state,
  reveal: {
    ...state.reveal,
    fullBreakdown: [
      {
        canonicalId: 'f-tofu',
        text: 'Tofu',
        position: 1,
        guesses: [
          // This Guesser's own id — proving their column is not filtered out, unlike
          // the Ranker's version there is no "self" to exclude here either.
          { playerId: 'guesser', displayName: 'You', position: 1, correct: true, submitted: true },
          { playerId: 'ana', displayName: 'Ana', position: 3, correct: false, submitted: true },
        ],
      },
      {
        canonicalId: 'f-cats',
        text: 'Gatos',
        position: 2,
        guesses: [
          { playerId: 'guesser', displayName: 'You', position: 2, correct: true, submitted: true },
          { playerId: 'ana', displayName: 'Ana', position: 2, correct: true, submitted: true },
        ],
      },
    ],
  },
} as unknown as GameStateView;

describe('a Guesser with more than one eligible Guesser in the turn', () => {
  it('sees the same unfiltered breakdown as the Ranker, including their own column', () => {
    render(<RevealView state={guesserWithFullBreakdown} roomCode="ABCDEF" refresh={vi.fn()} />);

    expect(screen.getByText('Cómo ha adivinado cada persona')).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'You' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Ana' })).toBeVisible();
  });
});
