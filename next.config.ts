import type { NextConfig } from 'next';
const config: NextConfig = {
  // Spotify OAuth requires a literal loopback address for local HTTP callbacks.
  allowedDevOrigins: ['127.0.0.1'],
};
export default config;
