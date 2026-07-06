/** @type {import('next').NextConfig} */

// En desarrollo el navegador habla con Next (mismo origen) y Next reenvia /api
// al backend. Asi las cookies HttpOnly funcionan sin CORS ni cross-site.
// En produccion nginx enruta /api directamente al backend.
const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:8000";

const nextConfig = {
  reactStrictMode: true,
  // El dev server corre dentro de Docker; el navegador entra por 127.0.0.1.
  // Sin esto Next 16 bloquea los recursos /_next/* y la pagina no hidrata.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
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
