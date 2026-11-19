import { clampBrightness } from './brightness';

describe('clampBrightness', () => {
  it('keeps values inside the slider range, on its 5% steps', () => {
    expect(clampBrightness(100)).toBe(100);
    expect(clampBrightness(87)).toBe(85);
    expect(clampBrightness(88)).toBe(90);
    expect(clampBrightness(10)).toBe(70);
    expect(clampBrightness(400)).toBe(130);
  });

  it('treats unreadable stored values as unchanged', () => {
    expect(clampBrightness(Number('abc'))).toBe(100);
    expect(clampBrightness(Number.POSITIVE_INFINITY)).toBe(100);
  });
});
