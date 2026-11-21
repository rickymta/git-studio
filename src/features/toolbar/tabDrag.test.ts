import { describe, expect, it } from 'vitest';

import { dropIndex, edgeSpeed, shiftFor } from './tabDrag';

// Four 100px tabs: centres at 50, 150, 250, 350.
const centers = [50, 150, 250, 350];

describe('dropIndex', () => {
  it('stays put until the dragged centre passes a neighbour centre', () => {
    expect(dropIndex(centers, 1, 150)).toBe(1);
    expect(dropIndex(centers, 1, 240)).toBe(1);
    expect(dropIndex(centers, 1, 260)).toBe(2);
    expect(dropIndex(centers, 1, 60)).toBe(1);
    expect(dropIndex(centers, 1, 40)).toBe(0);
  });

  it('clamps to the ends', () => {
    expect(dropIndex(centers, 0, -500)).toBe(0);
    expect(dropIndex(centers, 0, 5000)).toBe(3);
    expect(dropIndex(centers, 3, -500)).toBe(0);
  });
});

describe('shiftFor', () => {
  it('slides the tabs between the two slots over to open the gap', () => {
    // Tab 0 dragged to slot 2: tabs 1 and 2 move left.
    expect([0, 1, 2, 3].map((j) => shiftFor(j, 0, 2, 100))).toEqual([0, -100, -100, 0]);
    // Tab 3 dragged to slot 1: tabs 1 and 2 move right.
    expect([0, 1, 2, 3].map((j) => shiftFor(j, 3, 1, 100))).toEqual([0, 100, 100, 0]);
    // Not moved: nothing shifts.
    expect([0, 1, 2, 3].map((j) => shiftFor(j, 2, 2, 100))).toEqual([0, 0, 0, 0]);
  });
});

describe('edgeSpeed', () => {
  it('scrolls only near the edges, faster closer to them', () => {
    expect(edgeSpeed(500, 0, 1000)).toBe(0);
    expect(edgeSpeed(20, 0, 1000)).toBeLessThan(0);
    expect(edgeSpeed(-50, 0, 1000)).toBe(-18);
    expect(edgeSpeed(990, 0, 1000)).toBeGreaterThan(edgeSpeed(970, 0, 1000));
    // A strip too narrow to tell the edges from the middle never scrolls.
    expect(edgeSpeed(5, 0, 100)).toBe(0);
  });
});
