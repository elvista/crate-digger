import type { NextConfig } from 'next';
const config: NextConfig = {
  // Spotify OAuth requires a literal loopback address for local HTTP callbacks.
  allowedDevOrigins: ['127.0.0.1'],
  async redirects() {
    return [{
      source: '/:path*',
      has: [{ type: 'host', value: 'crate-digger-nine-pink.vercel.app' }],
      destination: 'https://crate-tinder.vercel.app/:path*',
      permanent: true,
    }];
  },
};
export default config;
