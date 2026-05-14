import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [],
  },
  // Allow large uploads through the proxy (up to 200MB)
  serverExternalPackages: [],
  async rewrites() {
    return [
      // Webhook routes handled by Next.js — do NOT proxy to backend
      {
        source: "/api/webhooks/:path*",
        destination: "/api/webhooks/:path*",
      },
      {
        source: "/api/debug-backend",
        destination: "/api/debug-backend",
      },
      // All other API requests proxied to backend
      {
        source: "/api/:path*",
        destination: "https://cruel-cougars-scream.loca.lt/api/:path*",
      },
    ];
  },
};

export default nextConfig;
