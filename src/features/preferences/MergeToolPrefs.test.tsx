// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as UiModule from '@/stores/ui';
import { change, cleanup, render } from '@/test/dom';
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
  const [merge, diff] = [...document.querySelectorAll('select')];
  if (!merge || !diff) throw new Error('expected the merge and diff tool selects');
  return [merge, diff] as const;
};
const options = (s: HTMLSelectElement) => [...s.options].map((o) => o.value);

describe('MergeToolPrefs', () => {
  it('lists the tools found here, then the others, and keeps a custom one', async () => {
    await render(<MergeToolPrefs />);
    const [merge, diff] = selects();
    expect(merge.value).toBe('mytool');
    expect(options(merge)).toEqual(['', 'mytool', 'meld', 'vscode', 'kdiff3']);
    expect(diff.value).toBe('');
    expect(options(diff)).toEqual(['', 'meld', 'vscode', 'kdiff3']);
    expect([...merge.querySelectorAll('optgroup')].map((g) => g.label)).toEqual([
      'Found on this computer',
      'Other tools git supports',
    ]);
  });

  it('saves the choice to git config', async () => {
    await render(<MergeToolPrefs />);
    await change(selects()[1], 'meld');
    expect(api.setTool).toHaveBeenCalledWith('diff', 'meld');
    expect(selects()[1].value).toBe('meld');
    await change(selects()[0], '');
    expect(api.setTool).toHaveBeenCalledWith('merge', '');
  });

  it('keeps the old value and says so when saving fails', async () => {
    api.setTool.mockRejectedValue(new Error('config locked'));
    await render(<MergeToolPrefs />);
    await change(selects()[0], 'meld');
    expect(toast).toHaveBeenCalledWith('error', 'Could not save the tool', 'config locked');
    expect(selects()[0].value).toBe('mytool');
  });
});
