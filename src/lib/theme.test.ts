import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, initializeTheme, readTheme, storeTheme } from './theme';

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0F766E');
});

describe('local colour theme', () => {
  it('uses the classic theme by default', () => {
    expect(readTheme()).toBe('classic');
    expect(initializeTheme()).toBe('classic');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('stores and applies a selected theme', () => {
    storeTheme('berry');
    expect(readTheme()).toBe('berry');
    expect(document.documentElement.dataset.theme).toBe('berry');
  });

  it('restores a stored theme on startup', () => {
    window.localStorage.setItem('sortitout.theme.v1', 'ocean');
    expect(initializeTheme()).toBe('ocean');
    expect(document.documentElement.dataset.theme).toBe('ocean');
  });

  it('ignores unsupported stored values', () => {
    window.localStorage.setItem('sortitout.theme.v1', 'ultraviolet');
    expect(readTheme()).toBe('classic');
  });

  it('can return to the classic theme', () => {
    applyTheme('ocean');
    applyTheme('classic');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
