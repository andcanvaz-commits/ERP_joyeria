/** @type {import('next').NextConfig} */

// En desarrollo el navegador habla con Next (mismo origen) y Next reenvia /api
// al backend. Asi las cookies HttpOnly funcionan sin CORS ni cross-site.
// En produccion nginx enruta /api directamente al backend.
const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:8000";

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyTarget}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
