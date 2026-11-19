#!/usr/bin/env node
// Build the native file-manager overlay pieces for the platform being bundled
// (runs from tauri.conf.json → build.beforeBuildCommand, after the frontend build):
//   Windows: crates/gitstudio-overlay-win → src-tauri/overlay/gitstudio_overlay.dll
//   macOS:   macos/finder-sync → macos/build/GitStudioFinder.appex
//   Linux:   nothing to build (src-tauri/overlay/gitstudio_overlay.py ships as is)
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || '';
const platform =
  process.env.TAURI_ENV_PLATFORM ||
  { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
const debug = process.env.TAURI_ENV_DEBUG === 'true';
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (platform === 'windows') {
  const args = ['build', '-p', 'gitstudio-overlay-win'];
  if (!debug) args.push('--release');
  if (triple) args.push('--target', triple);
  run('cargo', args);
  const dir = join(root, 'target', ...(triple ? [triple] : []), debug ? 'debug' : 'release');
  const dll = join(dir, 'gitstudio_overlay.dll');
  if (!existsSync(dll)) {
    console.error(`missing ${dll}`);
    process.exit(1);
  }
  mkdirSync(join(root, 'src-tauri', 'overlay'), { recursive: true });
  copyFileSync(dll, join(root, 'src-tauri', 'overlay', 'gitstudio_overlay.dll'));
  console.log('overlay: gitstudio_overlay.dll ready');
} else if (platform === 'darwin') {
  run('bash', [join(root, 'macos', 'finder-sync', 'build.sh'), triple || '', version]);
} else {
  console.log('overlay: nothing to build on this platform');
}
