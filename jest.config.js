// Jest runs in native ESM mode (NestJS 12 is ESM-only), so `npm test` starts Node with
// --experimental-vm-modules. SWC transpiles TypeScript and emits the decorator metadata Nest needs.

/** @type {import('@swc/core').Options} */
const swcOptions = {
  swcrc: false,
  jsc: {
    target: 'es2023',
    keepClassNames: true,
    parser: { syntax: 'typescript', decorators: true },
    transform: { legacyDecorator: true, decoratorMetadata: true },
  },
  module: { type: 'es6' },
  sourceMaps: 'inline',
};

/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/apps', '<rootDir>/packages'],
  testMatch: ['**/test/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  modulePathIgnorePatterns: ['<rootDir>/apps/web/.next/'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: { '^.+\\.ts$': ['@swc/jest', swcOptions] },
  // Source uses NodeNext-style imports ('./foo.js'); point them at the .ts file during tests.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
};
