import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// NestJS needs decorator metadata, which Vite's default transformer (esbuild/oxc) does not emit.
// SWC reads experimentalDecorators/emitDecoratorMetadata from tsconfig.json.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    name: 'api',
    root: import.meta.dirname,
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
