import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

// `pnpm release` keeps package.json in step with tauri.conf.json and Cargo.toml.
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

// Fixed port so tauri.conf.json `devUrl` matches.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/crates/**', '**/target/**'] },
  },
  build: { target: 'es2022', sourcemap: false },
  test: {
    globals: true,
    environment: 'node',
    // Agent worktrees under .claude/ are full checkouts: their tests are not this tree's.
    exclude: [...configDefaults.exclude, '.claude/**', 'target/**'],
  },
});
