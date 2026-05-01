/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Required for pages/api alongside app/ directory
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'prisma'],
  },
};

module.exports = nextConfig;
