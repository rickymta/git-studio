/**
 * The arithmetic behind dragging a tab along its group (pinned tabs, or the scrolling strip).
 * Positions are in one coordinate space (the strip's content, so scrolling does not matter).
 */

/** Where the dragged item lands: the number of other items whose centre is left of its centre. */
export function dropIndex(centers: readonly number[], from: number, draggedCenter: number): number {
  let n = 0;
  centers.forEach((c, j) => {
    if (j !== from && c < draggedCenter) n++;
  });
  return n;
}

/**
 * How far item `j` moves aside while the item at `from` (`width` wide) hovers over slot `to`:
 * the items between the two slide over by its width to open the gap.
 */
export function shiftFor(j: number, from: number, to: number, width: number): number {
  if (j === from) return 0;
  if (to > from && j > from && j <= to) return -width;
  if (to < from && j >= to && j < from) return width;
  return 0;
}

/**
 * Auto-scroll speed (px per frame) for a pointer at `x` near the edges of `[left, right]`:
 * negative to the left, positive to the right, faster the closer to (or past) the edge.
 */
export function edgeSpeed(x: number, left: number, right: number, zone = 40, max = 18): number {
  if (right - left < zone * 3) return 0;
  if (x < left + zone) return -Math.ceil(max * Math.min(1, (left + zone - x) / zone));
  if (x > right - zone) return Math.ceil(max * Math.min(1, (x - (right - zone)) / zone));
  return 0;
}
