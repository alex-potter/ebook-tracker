/** @type {import('next').NextConfig} */
const { version } = require('./package.json');

const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  disable: process.env.NEXT_PUBLIC_CAPACITOR === 'true' || process.env.NODE_ENV === 'development',
  register: false,
  scope: (process.env.NEXT_PUBLIC_BASE_PATH || '') + '/',
  workboxOptions: {
    cleanupOutdatedCaches: true,
    skipWaiting: false,
    clientsClaim: false,
    runtimeCaching: [
      {
        urlPattern: /^https:\/\/api\.github\.com\/repos\/.+\/git\/trees\/.+/,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'gh-library-catalog',
          expiration: { maxEntries: 8, maxAgeSeconds: 86400 },
        },
      },
      {
        urlPattern: /^https:\/\/raw\.githubusercontent\.com\/.+/,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'gh-library-assets',
          expiration: { maxEntries: 50, maxAgeSeconds: 604800 },
        },
      },
      {
        urlPattern: /^https:\/\/fonts\.(?:gstatic|googleapis)\.com\/.+/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'google-fonts',
          expiration: { maxEntries: 20, maxAgeSeconds: 31536000 },
        },
      },
    ],
  },
});

const isMobile = process.env.NEXT_PUBLIC_MOBILE === 'true';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: version },
  ...(isMobile ? { output: 'export', trailingSlash: true } : {}),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  images: { unoptimized: isMobile },
};

module.exports = withPWA(nextConfig);
