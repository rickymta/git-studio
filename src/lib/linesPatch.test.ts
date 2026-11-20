// @vitest-environment node
// Runs real `git apply` on the patches, so it needs Node's APIs.
/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { linesPatch, parseDiff } from './diff';

const dir = mkdtempSync(join(tmpdir(), 'gs-lines-'));
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', input: '' });
const gitIn = (input: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', input });

afterAll(() => rmSync(dir, { recursive: true, force: true }));

git('init', '-q');
git('config', 'user.name', 'T');
git('config', 'user.email', 't@example.com');
git('config', 'core.autocrlf', 'false');
writeFileSync(join(dir, 'f.txt'), 'one\ntwo\nthree\nfour\n');
git('add', '.');
git('commit', '-q', '-m', 'base');

/** Index indexes of the changed lines whose text is in `texts`. */
const pick = (diff: ReturnType<typeof parseDiff>, texts: string[]) =>
  diff.hunks[0]!.lines.flatMap((l, i) =>
    l.kind !== 'ctx' && l.kind !== 'meta' && texts.includes(l.text) ? [i] : [],
  );
const show = (spec: string) => git('show', spec);

describe('linesPatch with git apply', () => {
  it('stages, unstages and discards single lines', () => {
    // Working tree: "two" → "TWO", "four" removed, "five" added.
    writeFileSync(join(dir, 'f.txt'), 'one\nTWO\nthree\nfive\n');
    const unstaged = parseDiff(git('diff', '--', 'f.txt'));
    expect(unstaged.hunks).toHaveLength(1);

    // Stage only "two" → "TWO".
    const stage = linesPatch(unstaged, 0, pick(unstaged, ['two', 'TWO']), false)!;
    gitIn(stage, 'apply', '--cached', '--recount', '-');
    expect(show(':f.txt')).toBe('one\nTWO\nthree\nfour\n');

    // Stage the removal of "four" only (not the addition of "five").
    const rest = parseDiff(git('diff', '--', 'f.txt'));
    gitIn(linesPatch(rest, 0, pick(rest, ['four']), false)!, 'apply', '--cached', '--recount', '-');
    expect(show(':f.txt')).toBe('one\nTWO\nthree\n');

    // Unstage "TWO" again, keeping the staged removal.
    const staged = parseDiff(git('diff', '--cached', '--', 'f.txt'));
    const unstage = linesPatch(staged, 0, pick(staged, ['two', 'TWO']), true)!;
    gitIn(unstage, 'apply', '--cached', '--reverse', '--recount', '-');
    expect(show(':f.txt')).toBe('one\ntwo\nthree\n');

    // Discard the "five" line from the working tree only.
    const wt = parseDiff(git('diff', '--', 'f.txt'));
    gitIn(linesPatch(wt, 0, pick(wt, ['five']), true)!, 'apply', '--reverse', '--recount', '-');
    expect(readFileSync(join(dir, 'f.txt'), 'utf8')).toBe('one\nTWO\nthree\n');
  });

  it('is null without a changed line', () => {
    const d = parseDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n');
    expect(linesPatch(d, 0, [0], false)).toBeNull();
    // Only "+c": the unchosen removal of "b" stays as context.
    expect(linesPatch(d, 0, [2], false)).toMatch(/@@ -1,2 \+1,2 @@\n a\n b\n\+c\n$/);
    // In reverse, the unchosen addition of "c" stays as context and "-b" is left out.
    expect(linesPatch(d, 0, [2], true)).toMatch(/@@ -1,2 \+1,2 @@\n a\n\+c\n$/);
  });
});
