// Jest runs in native ESM mode (NestJS 12 is ESM-only), so `npm test` starts Node with
// --experimental-vm-modules. SWC transpiles TypeScript and emits the decorator metadata Nest needs.
//
// Two projects:
// - unit:        *.test.ts, no external services.
// - integration: *.int.test.ts, need PostgreSQL. globalSetup recreates a dedicated *_test
//                database and applies migrations before the run.

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
const common = {
  testEnvironment: 'node',
  roots: ['<rootDir>/apps', '<rootDir>/packages'],
  modulePathIgnorePatterns: ['<rootDir>/apps/web/.next/'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: { '^.+\\.ts$': ['@swc/jest', swcOptions] },
  moduleNameMapper: {
    // Source uses NodeNext-style imports ('./foo.js'); point them at the .ts file during tests.
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // The web app's import alias (paths in apps/web/tsconfig.json).
    '^@/(.*)$': '<rootDir>/apps/web/src/$1',
  },
};

/** @type {import('jest').Config} */
export default {
  projects: [
    {
      ...common,
      displayName: 'unit',
      testMatch: ['**/test/**/*.test.ts'],
      testPathIgnorePatterns: ['/node_modules/', '/dist/', '\\.int\\.test\\.ts$'],
    },
    {
      ...common,
      displayName: 'integration',
      testMatch: ['**/test/**/*.int.test.ts'],
      testPathIgnorePatterns: ['/node_modules/', '/dist/'],
      globalSetup: '<rootDir>/apps/api/test/support/global-setup.ts',
    },
  ],
};
