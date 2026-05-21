import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./app/i18n/request.ts');

const serverApiBase = process.env.NEXT_SERVER_API_BASE_URL ?? 'http://127.0.0.1:8000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${serverApiBase}/api/:path*` },
      { source: '/health', destination: `${serverApiBase}/health` },
      { source: '/openapi.json', destination: `${serverApiBase}/openapi.json` },
    ];
  },
};

export default withNextIntl(nextConfig);
