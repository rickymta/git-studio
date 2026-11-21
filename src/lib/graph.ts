import type { Commit, Stash } from './types';

/** Vertical anchor inside a row: top edge, centre (the node), bottom edge. */
export type Anchor = 0 | 1 | 2;

export interface Segment {
  fromLane: number;
  fromY: Anchor;
  toLane: number;
  toY: Anchor;
  color: number;
  /** Stash links are drawn dotted. */
  dashed?: boolean;
}

/** Where the line a commit sits on starts: a branch tip, or the merge that opened it. */
export interface LaneStart {
  hash: string;
  /** The lane was opened for a merge's second parent: `hash` is that merge commit. */
  merge: boolean;
}

export interface GraphRow {
  /** Lane of this commit's node. */
  lane: number;
  color: number;
  segments: Segment[];
  /** Number of lanes in use around this row (for width). */
  width: number;
  /** Start of this commit's line (null for stash rows). */
  from: LaneStart | null;
}

/** Lane palette size; the colours are `--lane-0…9` in index.css so each theme tunes them. */
const LANE_COUNT = 10;

/** Hue of each lane colour (degrees) in the light and the dark theme, see index.css. */
const HUES_LIGHT = [235, 350, 65, 148, 295, 35, 185, 100, 262, 320];
const HUES_DARK = [198, 325, 40, 133, 255, 10, 175, 53, 219, 285];

const arc = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** How far apart two lane colours look: the smaller hue gap of the two themes. */
export function hueGap(a: number, b: number): number {
  const i = a % LANE_COUNT;
  const j = b % LANE_COUNT;
  return Math.min(arc(HUES_LIGHT[i]!, HUES_LIGHT[j]!), arc(HUES_DARK[i]!, HUES_DARK[j]!));
}

const indexes = new WeakMap<Commit[], Map<string, number>>();

/**
 * Hash → row of a commit list, built once per list. Building it costs ~1 µs a commit (over half a
 * second at 500,000), so a list grown by `carryIndex` takes the old index over instead.
 */
export function hashIndex(commits: Commit[]): Map<string, number> {
  let m = indexes.get(commits);
  if (!m) {
    m = new Map();
    for (let i = 0; i < commits.length; i++) m.set(commits[i]!.hash, i);
    indexes.set(commits, m);
  }
  return m;
}

/**
 * `next` is `prev` with rows added at the end: its index is `prev`'s, extended (and `prev` loses
 * its cached one, so a later lookup on it builds a fresh one).
 */
export function carryIndex(prev: Commit[], next: Commit[]) {
  const m = indexes.get(prev);
  if (!m) return;
  for (let i = prev.length; i < next.length; i++) m.set(next[i]!.hash, i);
  indexes.delete(prev);
  indexes.set(next, m);
}

/** Stash rows go just above the newest commit older than them, and never below their base. */
export function withStashes(commits: Commit[], stashes: Stash[]): Commit[] {
  if (stashes.length === 0) return commits;
  const index = hashIndex(commits);
  const at = new Map<number, Commit[]>();
  for (const s of stashes) {
    const baseIdx = s.base ? index.get(s.base) : undefined;
    if (baseIdx === undefined) continue;
    let pos = commits.findIndex((c) => c.commitTime <= s.time);
    if (pos === -1 || pos > baseIdx) pos = baseIdx;
    const row: Commit = {
      hash: s.hash,
      parents: [s.base!],
      authorName: '',
      authorEmail: '',
      authorTime: s.time,
      committerName: '',
      commitTime: s.time,
      // "On main: message" / "WIP on main: abc message" → just the message, like GitKraken.
      subject: s.message.replace(/^(?:WIP on|On) [^:]+: /, ''),
      stash: s,
    };
    at.set(pos, [...(at.get(pos) ?? []), row]);
  }
  if (at.size === 0) return commits;
  const out: Commit[] = [];
  commits.forEach((c, i) => {
    out.push(...(at.get(i) ?? []), c);
  });
  return out;
}

/** The lanes after the last laid-out row: what the next rows continue from. */
interface LayoutState {
  lanes: (string | null)[];
  colors: number[];
  /** Where each lane's current line started. */
  origin: (LaneStart | null)[];
  /** Lanes carrying a dotted stash link down to its base commit. */
  dashed: Set<number>;
  /** Pinned lanes whose tip row has not come yet. */
  waiting: Set<number>;
  nextColor: number;
}

/** State at the end of each laid-out row list, so later pages continue it (`extendGraph`). */
const finalState = new WeakMap<GraphRow[], LayoutState>();
/** The WIP row laid out above the commits (see `layoutGraph`'s `wip`). */
const wipRows = new WeakMap<GraphRow[], GraphRow>();

/** Row of the uncommitted changes laid out with `rows`, if they were laid out with one. */
export const wipRowOf = (rows: GraphRow[]): GraphRow | null => wipRows.get(rows) ?? null;

const cloneState = (st: LayoutState): LayoutState => ({
  lanes: [...st.lanes],
  colors: [...st.colors],
  origin: [...st.origin],
  dashed: new Set(st.dashed),
  waiting: new Set(st.waiting),
  nextColor: st.nextColor,
});

/**
 * Assign every commit (children before parents, as `git log --date-order` emits them) a lane and
 * the line segments to draw in its row. Lanes keep their colour from tip to fork point.
 *
 * `wip`: HEAD's commit when there are uncommitted changes. Their row sits above all commits with a
 * lane of its own, dotted down to HEAD however far below it is (other branches' newer commits in
 * between), like a stash hanging from its base; HEAD's line then carries on in that lane. The row
 * is read back with `wipRowOf`.
 */
export function layoutGraph(
  commits: Commit[],
  pinned: string[] = [],
  wip: string | null = null,
): GraphRow[] {
  const st: LayoutState = {
    lanes: [],
    colors: [],
    origin: [],
    dashed: new Set(),
    waiting: new Set(),
    nextColor: 0,
  };
  const wipRow: GraphRow[] = [];
  const pre = wip ? [wipCommit(wip)] : [];
  const rows = runLayout(st, commits, [], pinned, { commits: pre, rows: wipRow });
  finalState.set(rows, st);
  if (wipRow[0]) wipRows.set(rows, wipRow[0]);
  return rows;
}

/** The uncommitted changes as a stash-like row hanging from HEAD. */
const wipCommit = (head: string): Commit => ({
  hash: '',
  parents: [head],
  authorName: '',
  authorEmail: '',
  authorTime: 0,
  committerName: '',
  commitTime: 0,
  subject: '',
  stash: { index: -1, name: '', hash: '', message: '', time: 0, base: head },
});

/**
 * The rows of `prev` followed by those of `more`, the commits right after the ones `prev` was laid
 * out for: only the new commits are laid out, continuing where `prev` ended (pages of a long
 * history). Null when `prev` has no saved end state (then lay out the whole list again).
 */
export function extendGraph(prev: GraphRow[], more: Commit[]): GraphRow[] | null {
  const end = finalState.get(prev);
  if (!end) return null;
  const st = cloneState(end);
  const rows = runLayout(st, more, prev.slice());
  finalState.set(rows, st);
  const wip = wipRows.get(prev);
  if (wip) wipRows.set(rows, wip);
  return rows;
}

function runLayout(
  st: LayoutState,
  commits: Commit[],
  rows: GraphRow[],
  pinned: string[] = [],
  /** Rows laid out before `commits` (after the pinned lanes), kept apart: the WIP row. */
  pre: { commits: Commit[]; rows: GraphRow[] } = { commits: [], rows: [] },
): GraphRow[] {
  const { lanes, colors, origin, dashed, waiting } = st;

  /**
   * Colour for a line starting in `lane`: the palette entry that differs most in hue from the
   * lines beside it (the next lanes count less) and from `related` (the line it forks from or
   * merges into), so neighbouring lines never look alike. Ties go round the palette, so lines far
   * apart still get varied colours.
   */
  const pickColor = (lane: number, related: number[] = []) => {
    const near: { color: number; weight: number }[] = related.map((color) => ({
      color,
      weight: 1,
    }));
    for (const d of [-1, 1, -2, 2]) {
      const j = lane + d;
      if (j >= 0 && j < lanes.length && lanes[j] !== null && colors[j] !== undefined)
        near.push({ color: colors[j]!, weight: Math.abs(d) === 1 ? 1 : 0.6 });
    }
    // The line that last ended in this lane: a new one right under it should not look continued.
    if (colors[lane] !== undefined) near.push({ color: colors[lane]!, weight: 0.8 });
    let best = st.nextColor % LANE_COUNT;
    let bestScore = -1;
    for (let i = 0; i < LANE_COUNT; i++) {
      const k = (st.nextColor + i) % LANE_COUNT;
      let score = Infinity;
      for (const n of near) score = Math.min(score, hueGap(k, n.color) / n.weight);
      if (score > bestScore) {
        best = k;
        bestScore = score;
      }
    }
    st.nextColor = best + 1;
    return best;
  };

  // "Pin to Left": each pinned branch tip owns lane 0, 1, … from the top. Its lane waits empty
  // (nothing drawn) until the tip's row, or until a child links into it.
  const present = pinned.length ? new Set(commits.map((c) => c.hash)) : new Set<string>();
  for (const tip of pinned) {
    if (!present.has(tip) || lanes.includes(tip)) continue;
    waiting.add(lanes.length);
    colors[lanes.length] = pickColor(lanes.length);
    origin[lanes.length] = { hash: tip, merge: false };
    lanes.push(tip);
  }

  const freeLane = (avoid = -1) => {
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === null && i !== avoid) return i;
    lanes.push(null);
    return lanes.length - 1;
  };

  /** Lane waiting for `hash`, preferring real branch lines over stash links. */
  const laneOf = (hash: string) => {
    let any = -1;
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== hash) continue;
      if (!dashed.has(i)) return i;
      if (any === -1) any = i;
    }
    return any;
  };

  const place = (c: Commit, rows: GraphRow[]) => {
    const segments: Segment[] = [];
    if (c.stash) {
      // Own lane, coloured like the line it hangs from (or the row above), dotted to its base.
      const base = c.parents[0]!;
      const k = laneOf(base);
      // The base's line colour; if its line has not started yet, the colour it will get.
      const lane = freeLane();
      const color = k >= 0 ? colors[k]! : pickColor(lane);
      for (let j = 0; j < lanes.length; j++) {
        if (j !== lane && lanes[j] !== null && !waiting.has(j))
          segments.push({
            fromLane: j,
            fromY: 0,
            toLane: j,
            toY: 2,
            color: colors[j]!,
            dashed: dashed.has(j),
          });
      }
      lanes[lane] = base;
      colors[lane] = color;
      origin[lane] = k >= 0 ? (origin[k] ?? null) : null;
      dashed.add(lane);
      segments.push({ fromLane: lane, fromY: 1, toLane: lane, toY: 2, color, dashed: true });
      rows.push({ lane, color, segments, width: lanes.length, from: null });
      return;
    }
    let lane = laneOf(c.hash);
    if (lane === -1) {
      // Branch tip nobody pointed at yet: starts in this row.
      lane = freeLane();
      colors[lane] = pickColor(lane);
      lanes[lane] = c.hash;
      origin[lane] = { hash: c.hash, merge: false };
    } else if (dashed.has(lane)) {
      // Only a stash pointed here: the commit's own line starts in this row.
      segments.push({
        fromLane: lane,
        fromY: 0,
        toLane: lane,
        toY: 1,
        color: colors[lane]!,
        dashed: true,
      });
      // Keeps the colour the stash already took for it; its own line starts here.
      dashed.delete(lane);
      origin[lane] = { hash: c.hash, merge: false };
    } else if (waiting.has(lane)) {
      // Pinned tip: its lane starts here.
      waiting.delete(lane);
    } else {
      segments.push({ fromLane: lane, fromY: 0, toLane: lane, toY: 1, color: colors[lane]! });
    }
    const color = colors[lane]!;
    const from = origin[lane] ?? null;

    // Other lanes waiting for this commit merge into the node.
    for (let j = 0; j < lanes.length; j++) {
      if (j !== lane && lanes[j] === c.hash) {
        segments.push({
          fromLane: j,
          fromY: 0,
          toLane: lane,
          toY: 1,
          color: colors[j]!,
          dashed: dashed.has(j),
        });
        lanes[j] = null;
        origin[j] = null;
        dashed.delete(j);
      }
    }
    // Lanes passing straight through this row.
    for (let j = 0; j < lanes.length; j++) {
      if (j !== lane && lanes[j] !== null && !waiting.has(j)) {
        segments.push({
          fromLane: j,
          fromY: 0,
          toLane: j,
          toY: 2,
          color: colors[j]!,
          dashed: dashed.has(j),
        });
      }
    }
    const widthBefore = lanes.length;

    const [first, ...rest] = c.parents;
    if (first === undefined) {
      lanes[lane] = null;
      origin[lane] = null;
    } else {
      lanes[lane] = first;
      segments.push({ fromLane: lane, fromY: 1, toLane: lane, toY: 2, color });
      for (const p of rest) {
        let k = laneOf(p);
        if (dashed.has(k)) k = -1;
        waiting.delete(k);
        if (k === -1) {
          k = freeLane(lane);
          colors[k] = pickColor(k, [color]);
          lanes[k] = p;
          origin[k] = { hash: c.hash, merge: true };
        }
        segments.push({ fromLane: lane, fromY: 1, toLane: k, toY: 2, color: colors[k]! });
      }
    }

    const width = Math.max(widthBefore, lanes.length, lane + 1);
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
      origin.length = Math.min(origin.length, lanes.length);
    }
    rows.push({ lane, color, segments, width, from });
  };
  for (const c of pre.commits) place(c, pre.rows);
  for (const c of commits) place(c, rows);
  return rows;
}

export const laneColor = (i: number) => `var(--lane-${i % LANE_COUNT})`;
