import { jest } from '@jest/globals';

// Integration tests share one database and run their files side by side; some sign in twenty
// times in a row (argon2 each time). The default 5 s per test is too tight on a busy machine or
// CI runner. Jest 30 ignores testTimeout in a project's config, hence this setup file.
jest.setTimeout(20_000);
