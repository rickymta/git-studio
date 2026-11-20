// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as UiModule from '@/stores/ui';
import { cleanup, openSelect, pick, render, selectValue } from '@/test/dom';
import { MergeToolPrefs } from './MergeToolPrefs';

const api = vi.hoisted(() => ({ mergeTools: vi.fn(), setTool: vi.fn() }));
vi.mock('@/lib/ipc', () => ({ api, isTauri: false }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/stores/ui', async (orig) => ({ ...(await orig<typeof UiModule>()), toast }));

beforeEach(() => {
  api.mergeTools.mockResolvedValue({
    mergeTool: 'mytool',
    diffTool: '',
    available: ['meld', 'vscode'],
    other: ['kdiff3'],
  });
  api.setTool.mockResolvedValue(null);
});
afterEach(async () => {
  await cleanup();
  vi.clearAllMocks();
});

const selects = () => {
  const [merge, diff] = [...document.querySelectorAll('[role="combobox"]')];
  if (!merge || !diff) throw new Error('expected the merge and diff tool selects');
  return [merge, diff] as const;
};
/** Values of a select's options, in order (opens it, then closes it again). */
const options = async (s: Element) => {
  const values = (await openSelect(s)).map((o) => o.dataset.value);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return values;
};

describe('MergeToolPrefs', () => {
  it('lists the tools found here, then the others, and keeps a custom one', async () => {
    await render(<MergeToolPrefs />);
    const [merge, diff] = selects();
    expect(selectValue(merge)).toBe('mytool');
    expect(selectValue(diff)).toBe('');
    const opened = await openSelect(merge);
    expect(opened.map((o) => o.dataset.value)).toEqual(['', 'mytool', 'meld', 'vscode', 'kdiff3']);
    expect([...document.querySelectorAll('[data-select-group]')].map((g) => g.textContent)).toEqual(
      ['Found on this computer', 'Other tools git supports'],
    );
    await cleanup();
    await render(<MergeToolPrefs />);
    expect(await options(selects()[1])).toEqual(['', 'meld', 'vscode', 'kdiff3']);
  });

  it('saves the choice to git config', async () => {
    await render(<MergeToolPrefs />);
    await pick(selects()[1], 'meld');
    expect(api.setTool).toHaveBeenCalledWith('diff', 'meld');
    expect(selectValue(selects()[1])).toBe('meld');
    await pick(selects()[0], '');
    expect(api.setTool).toHaveBeenCalledWith('merge', '');
  });

  it('keeps the old value and says so when saving fails', async () => {
    api.setTool.mockRejectedValue(new Error('config locked'));
    await render(<MergeToolPrefs />);
    await pick(selects()[0], 'meld');
    expect(toast).toHaveBeenCalledWith('error', 'Could not save the tool', 'config locked');
    expect(selectValue(selects()[0])).toBe('mytool');
  });
});
