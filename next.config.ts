import type { NextConfig } from 'next';

const everywhere = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];
const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [
      { source: '/:path*', headers: everywhere },
      // A config header replaces a route's own, so the photo route keeps its sandbox CSP this way.
      {
        source: '/((?!api/v1/avatars/).*)',
        headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }],
      },
    ];
  },
};
export default config;
