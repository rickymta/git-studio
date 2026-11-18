import type { Commit } from './types';

/** Vertical anchor inside a row: top edge, centre (the node), bottom edge. */
export type Anchor = 0 | 1 | 2;

export interface Segment {
  fromLane: number;
  fromY: Anchor;
  toLane: number;
  toY: Anchor;
  color: number;
}

export interface GraphRow {
  /** Lane of this commit's node. */
  lane: number;
  color: number;
  segments: Segment[];
  /** Number of lanes in use around this row (for width). */
  width: number;
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

  for (const c of commits) {
    const segments: Segment[] = [];
    let lane = lanes.indexOf(c.hash);
    if (lane === -1) {
      // Branch tip nobody pointed at yet: starts in this row.
      lane = freeLane();
      lanes[lane] = c.hash;
      colors[lane] = nextColor++;
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
        segments.push({ fromLane: j, fromY: 0, toLane: lane, toY: 1, color: colors[j]! });
        lanes[j] = null;
      }
    }
    // Lanes passing straight through this row.
    for (let j = 0; j < lanes.length; j++) {
      if (j !== lane && lanes[j] !== null && !waiting.has(j)) {
        segments.push({ fromLane: j, fromY: 0, toLane: j, toY: 2, color: colors[j]! });
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
        let k = lanes.indexOf(p);
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

export const LANE_COLORS = [
  '#3fb6e8',
  '#e86fb6',
  '#f2b33d',
  '#7bd88f',
  '#a78bfa',
  '#f2795f',
  '#38d1c4',
  '#e3d26f',
  '#6f9ef2',
  '#d98cf2',
];

export const laneColor = (i: number) => LANE_COLORS[i % LANE_COLORS.length]!;
