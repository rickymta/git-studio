// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RepoStats } from '@/lib/types';
import { useRepo } from '@/stores/repo';
import { button, cleanup, click, render, text } from '@/test/dom';
import { MaintenanceDialog } from './MaintenanceDialog';

const stats: RepoStats = {
  looseObjects: 12,
  looseSize: 48 * 1024,
  packedObjects: 300,
  packs: 2,
  packSize: 1024 * 1024,
  prunePackable: 1,
  garbage: 0,
  garbageSize: 0,
};
const api = vi.hoisted(() => ({
  repoStats: vi.fn(),
  maintenance: vi.fn(),
}));
vi.mock('@/lib/ipc', () => ({ api, isTauri: false }));

beforeEach(() => {
  useRepo.setState({ path: '/repo' });
  api.repoStats.mockResolvedValue(stats);
});
afterEach(async () => {
  await cleanup();
  vi.clearAllMocks();
});

/** The Run button of the task row titled `title`. */
const runButton = (title: string) => {
  const row = [...document.querySelectorAll('div')].find(
    (d) => d.querySelector(':scope > div > div')?.textContent === title,
  );
  return row ? button('Run', row) : null;
};

describe('MaintenanceDialog', () => {
  it('shows the object database size', async () => {
    await render(<MaintenanceDialog open onClose={() => {}} />);
    expect(api.repoStats).toHaveBeenCalledWith('/repo');
    expect(text()).toContain('1.0 MB');
    expect(text()).toContain('300 object(s) in 2 pack(s)');
    expect(text()).toContain('48.0 KB');
  });

  it('runs a task, shows its output and reloads the stats', async () => {
    api.maintenance.mockResolvedValue({ ok: true, output: 'Counting objects: 312, done.' });
    await render(<MaintenanceDialog open onClose={() => {}} />);
    await click(runButton('Garbage collect'));
    expect(api.maintenance).toHaveBeenCalledWith('/repo', 'gc');
    expect(text()).toContain('Garbage collect: done');
    expect(text()).toContain('Counting objects: 312, done.');
    expect(api.repoStats).toHaveBeenCalledTimes(2);
  });

  it('reports problems fsck finds as a failure', async () => {
    api.maintenance.mockResolvedValue({ ok: false, output: 'error: bad object 1234' });
    await render(<MaintenanceDialog open onClose={() => {}} />);
    await click(runButton('Check integrity'));
    expect(api.maintenance).toHaveBeenCalledWith('/repo', 'fsck');
    expect(text()).toContain('Check integrity: failed');
    expect(text()).toContain('error: bad object 1234');
  });

  it('shows an error thrown by the backend as a failed task', async () => {
    api.maintenance.mockRejectedValue(new Error('git not found'));
    await render(<MaintenanceDialog open onClose={() => {}} />);
    await click(runButton('Repack'));
    expect(text()).toContain('Repack: failed');
    expect(text()).toContain('git not found');
  });

  it('renders nothing while closed', async () => {
    await render(<MaintenanceDialog open={false} onClose={() => {}} />);
    expect(api.repoStats).not.toHaveBeenCalled();
    expect(text()).toBe('');
  });
});
