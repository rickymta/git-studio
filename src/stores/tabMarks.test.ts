// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { cleanTag, tabMarkOf, TAG_MAX, useTabMarks } from './tabMarks';

beforeEach(() => {
  localStorage.clear();
  useTabMarks.setState({ marks: {} });
});

describe('tab colour and tag', () => {
  it('keeps tags short and tidy', () => {
    expect(TAG_MAX).toBe(5);
    expect(cleanTag('  backend  ')).toBe('backe');
    expect(cleanTag('a   b')).toBe('a b');
    expect(cleanTag('Thử nghiệm')).toBe('Thử n');
    expect(cleanTag('   ')).toBe('');
  });

  it('marks a repository by path, whatever the slashes or case', () => {
    const s = useTabMarks.getState();
    s.setColor('D:\\code\\api', 'blue');
    s.setTag('d:/CODE/api/', 'API');
    expect(tabMarkOf('D:/code/api')).toEqual({ color: 'blue', tag: 'API' });
    expect(JSON.parse(localStorage.getItem('gitstudio.tabMarks')!)).toEqual({
      'd:/code/api': { color: 'blue', tag: 'API' },
    });
  });

  it('forgets a repository once it has neither colour nor tag', () => {
    const s = useTabMarks.getState();
    s.setColor('D:/a', 'red');
    s.setTag('D:/a', 'x');
    s.setColor('D:/a', null);
    expect(tabMarkOf('D:/a')).toEqual({ tag: 'x' });
    s.setTag('D:/a', '');
    expect(useTabMarks.getState().marks).toEqual({});
  });
});
