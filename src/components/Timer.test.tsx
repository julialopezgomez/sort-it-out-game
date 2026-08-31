import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { Timer } from './Timer';

describe('the clock says when it has run out', () => {
  it('shows the remaining time while it is running', () => {
    render(<Timer ms={65_000} />);
    expect(screen.getByText('1:05')).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('game.timeUp'))).not.toBeInTheDocument();
  });

  it('raises a visible sign at zero, not just an announcement', () => {
    render(<Timer ms={0} />);
    // Two nodes carry the words: the sign itself and the screen-reader announcement.
    expect(screen.getAllByText(i18n.t('game.timeUp')).length).toBeGreaterThanOrEqual(2);
  });

  it('stays quiet on a paused clock, which has not run out', () => {
    render(<Timer ms={0} paused />);
    expect(screen.queryByText(i18n.t('game.timeUp'))).not.toBeInTheDocument();
  });

  it('says an unlimited phase has no clock at all', () => {
    render(<Timer ms={null} />);
    expect(screen.getByText(i18n.t('game.noTimeLimit'))).toBeInTheDocument();
  });
});
