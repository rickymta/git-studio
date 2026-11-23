// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Commit } from '@/lib/types';
import { cleanup, render } from '@/test/dom';
import { CommitRow } from './CommitGraph';
import type { Column } from './columnSettings';

vi.mock('@/lib/ipc', () => ({ api: {}, isTauri: false }));

const commit: Commit = {
  hash: 'abc1234def',
  parents: ['p'],
  authorName: 'QuanDH',
  authorEmail: 'q@example.com',
  authorTime: 0,
  committerName: '',
  commitTime: 0,
  subject: 'feat: something off the current branch',
};
const row = {
  lane: 0,
  color: 0,
  width: 2,
  from: null,
  segments: [{ fromLane: 1, toLane: 1, fromY: 0 as const, toY: 2 as const, color: 1 }],
};
const show = new Set<Column>(['refs', 'graph', 'message', 'author', 'date', 'sha']);

function renderRow(dim: boolean) {
  return render(
    <CommitRow
      start={0}
      index={0}
      commit={commit}
      row={row}
      refs={[]}
      laneLabel={null}
      geom={{ lane: 26, pad: 12, node: 12, compact: false }}
      show={show}
      selected={false}
      isHead={false}
      detached={false}
      match={false}
      dim={dim}
      faded={false}
      onRefHover={() => {}}
      onPick={() => {}}
    />,
  );
}

/** Every element from `el` up to the document has no opacity class. */
const unfaded = (el: Element | null) => {
  for (let e = el; e; e = e.parentElement)
    if (/\bopacity-\d/.test(e.getAttribute('class') ?? '')) return false;
  return true;
};

afterEach(cleanup);

describe('a dimmed graph row (Smart Branch Visibility)', () => {
  it('softens the text but keeps the graph lanes at full strength', async () => {
    const { container } = await renderRow(true);
    expect(unfaded(container.querySelector('svg'))).toBe(true);
    const message = container.querySelector(`[title="${commit.subject}"]`);
    expect(message?.className).toContain('opacity-50');
  });

  it('fades nothing when the row is not dimmed', async () => {
    const { container } = await renderRow(false);
    expect(container.querySelector(`[title="${commit.subject}"]`)?.className).not.toMatch(
      /opacity-\d/,
    );
  });
});
