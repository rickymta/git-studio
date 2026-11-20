// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RepoInfo, Workspaces } from '@/lib/types';
import { useRepo } from './repo';
import type * as UiModule from './ui';
import { useWorkspaces } from './workspace';

const api = vi.hoisted(() => ({
  saveWorkspaces: vi.fn(async (w: unknown) => w),
  workspaceStatus: vi.fn(async () => []),
}));
vi.mock('@/lib/ipc', () => ({ api, isTauri: false }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('./ui', async (orig) => ({ ...(await orig<typeof UiModule>()), toast }));

const info = (path: string) => ({ path, name: path.split('/').pop() }) as RepoInfo;
const data = (active: string): Workspaces => ({
  active,
  items: [{ id: 'w1', name: 'tech-blog', color: '#a78bfa', repos: ['D:/code/a'] }],
});
const repos = () => useWorkspaces.getState().data.items[0]!.repos;

beforeEach(() => {
  useWorkspaces.setState({ data: data('w1') });
  useRepo.setState({ tabs: [], refresh: async () => {}, loadSettings: async () => {} });
});
afterEach(() => vi.clearAllMocks());

describe('opening a repository in a workspace', () => {
  it('adds a repository opened in a new tab to the active workspace', async () => {
    await useRepo.getState().adopt(info('D:/code/b'));
    await vi.waitFor(() => expect(repos()).toEqual(['D:/code/a', 'D:/code/b']));
    expect(api.saveWorkspaces).toHaveBeenCalled();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Added b to tech-blog'));
  });

  it('leaves the workspace alone for a repository already in it', async () => {
    await useRepo.getState().adopt(info('d:\\code\\a'));
    expect(repos()).toEqual(['D:/code/a']);
    expect(api.saveWorkspaces).not.toHaveBeenCalled();
  });

  it('keeps a repository out when asked (clone without "add to workspace")', async () => {
    await useRepo.getState().adopt(info('D:/code/c'), { keepOutOfWorkspace: true });
    expect(repos()).toEqual(['D:/code/a']);
  });

  it('adds nothing when no workspace is active', async () => {
    useWorkspaces.setState({ data: data('') });
    await useRepo.getState().adopt(info('D:/code/d'));
    expect(repos()).toEqual(['D:/code/a']);
    expect(api.saveWorkspaces).not.toHaveBeenCalled();
  });
});
