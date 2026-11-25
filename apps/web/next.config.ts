import { join } from 'node:path';
import type { NextConfig } from 'next';

// Next runs with apps/web as the working directory; the monorepo root is two levels up.
const monorepoRoot = join(process.cwd(), '..', '..');
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  poweredByHeader: false,
  async rewrites() {
    // The browser always calls /api/* on the web origin. In production the reverse proxy sends
    // /api to the api service before it reaches Next; locally this rewrite does the same job.
    return [{ source: '/api/:path*', destination: `${apiInternalUrl}/api/:path*` }];
  },
};

export default nextConfig;
