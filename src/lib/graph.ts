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

export interface GraphRow {
  /** Lane of this commit's node. */
  lane: number;
  color: number;
  segments: Segment[];
  /** Number of lanes in use around this row (for width). */
  width: number;
}

/** Stash rows go just above the newest commit older than them, and never below their base. */
export function withStashes(commits: Commit[], stashes: Stash[]): Commit[] {
  const index = new Map(commits.map((c, i) => [c.hash, i]));
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

/**
 * Assign every commit (children before parents, as `git log --date-order` emits them) a lane and
 * the line segments to draw in its row. Lanes keep their colour from tip to fork point.
 */
export function layoutGraph(commits: Commit[], pinned: string[] = []): GraphRow[] {
  const lanes: (string | null)[] = [];
  const colors: number[] = [];
  let nextColor = 0;
  const rows: GraphRow[] = [];

  // "Pin to Left": each pinned branch tip owns lane 0, 1, … from the top. Its lane waits empty
  // (nothing drawn) until the tip's row, or until a child links into it.
  const present = new Set(commits.map((c) => c.hash));
  const waiting = new Set<number>();
  for (const tip of pinned) {
    if (!present.has(tip) || lanes.includes(tip)) continue;
    waiting.add(lanes.length);
    colors[lanes.length] = nextColor++;
    lanes.push(tip);
  }

  const freeLane = (avoid = -1) => {
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === null && i !== avoid) return i;
    lanes.push(null);
    return lanes.length - 1;
  };

  // Lanes carrying a dotted stash link down to its base commit.
  const dashed = new Set<number>();
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

  for (const c of commits) {
    const segments: Segment[] = [];
    if (c.stash) {
      // Own lane, coloured like the line it hangs from (or the row above), dotted to its base.
      const base = c.parents[0]!;
      const k = laneOf(base);
      // The base's line colour; if its line has not started yet, the colour it will get.
      const color = k >= 0 ? colors[k]! : nextColor++;
      const lane = freeLane();
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
      dashed.add(lane);
      segments.push({ fromLane: lane, fromY: 1, toLane: lane, toY: 2, color, dashed: true });
      rows.push({ lane, color, segments, width: lanes.length });
      continue;
    }
    let lane = laneOf(c.hash);
    if (lane === -1) {
      // Branch tip nobody pointed at yet: starts in this row.
      lane = freeLane();
      lanes[lane] = c.hash;
      colors[lane] = nextColor++;
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
      // Keeps the colour the stash already took for it.
      dashed.delete(lane);
    } else if (waiting.has(lane)) {
      // Pinned tip: its lane starts here.
      waiting.delete(lane);
    } else {
      segments.push({ fromLane: lane, fromY: 0, toLane: lane, toY: 1, color: colors[lane]! });
    }
    const color = colors[lane]!;

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
    } else {
      lanes[lane] = first;
      segments.push({ fromLane: lane, fromY: 1, toLane: lane, toY: 2, color });
      for (const p of rest) {
        let k = laneOf(p);
        if (dashed.has(k)) k = -1;
        waiting.delete(k);
        if (k === -1) {
          k = freeLane(lane);
          lanes[k] = p;
          colors[k] = nextColor++;
        }
        segments.push({ fromLane: lane, fromY: 1, toLane: k, toY: 2, color: colors[k]! });
      }
    }

    const width = Math.max(widthBefore, lanes.length, lane + 1);
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    rows.push({ lane, color, segments, width });
  }
  return rows;
}

/** Lane palette size; the colours are `--lane-0…9` in index.css so each theme tunes them. */
const LANE_COUNT = 10;

export const laneColor = (i: number) => `var(--lane-${i % LANE_COUNT})`;
