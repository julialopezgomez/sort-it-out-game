import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { Dialog } from './Dialog';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('Dialog focus management', () => {
  it('keeps an input focused when its controlled value changes', () => {
    const onBlur = vi.fn();

    function ControlledDialog() {
      const [value, setValue] = useState('');

      return (
        <Dialog open title="Add an item" onClose={() => undefined}>
          <input
            aria-label="Item"
            data-autofocus
            value={value}
            onBlur={onBlur}
            onChange={(event) => setValue(event.target.value)}
          />
        </Dialog>
      );
    }

    render(<ControlledDialog />);
    const input = screen.getByRole('textbox', { name: 'Item' });

    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'a' } });

    expect(input).toHaveFocus();
    expect(onBlur).not.toHaveBeenCalled();
  });
});
