import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Produces a self-contained server bundle, which keeps the Docker image small.
  output: 'standalone',
  experimental: {
    // Server Actions are the primary mutation channel for the management screens.
    serverActions: { bodySizeLimit: '1mb' },
  },
};

export default nextConfig;
