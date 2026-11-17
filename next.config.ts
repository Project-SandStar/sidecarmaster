import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['ws', 'better-sqlite3', '@node-rs/argon2', 'nodemailer', '@prisma/client', '@prisma/adapter-better-sqlite3'],
  outputFileTracingExcludes: { '*': ['data/**', 'docs/**', 'tests/**', '.git/**', '**/*.map'] },
};

export default nextConfig;
