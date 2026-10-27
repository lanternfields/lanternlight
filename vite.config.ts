/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

/**
 * Pins the controller/hand models IWSDK fetches from jsDelivr to an exact
 * release (its default is the floating @1.0 tag), so the judged build cannot
 * change underneath us.
 */
const INPUT_PROFILES_VERSION = '1.0.20';
const pinInputProfiles = {
  name: 'lanternlight-pin-input-profiles',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.includes('xr-input') || !code.includes('@webxr-input-profiles/assets@1.0/')) return null;
    return { code: code.split('@webxr-input-profiles/assets@1.0/').join(`@webxr-input-profiles/assets@${INPUT_PROFILES_VERSION}/`), map: null };
  },
};

export default defineConfig(({ command }) => ({
  plugins: [pinInputProfiles, iwsdkDev()],
  define: { __BUILD__: JSON.stringify(`v${pkg.version} ${stamp}Z`) },
  server: { host: 'localhost', port: 8081, open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (three@0.185 vs app super-three@0.181). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    // Production only: drop the ~1,600 lucide icons UIKitML would bundle (we have no UIKitML panels).
    alias:
      command === 'build'
        ? [{ find: /^@pmndrs\/uikit-lucide$/, replacement: fileURLToPath(new URL('./src/stubs/uikit-lucide.ts', import.meta.url)) }]
        : [],
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
}));
