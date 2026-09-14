import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Server Actions are the primary mutation channel for the management screens.
    serverActions: { bodySizeLimit: '1mb' },
  },
};

export default nextConfig;
