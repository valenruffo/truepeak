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
      // All other API requests proxied to backend
      {
        source: "/api/:path*",
        destination: "http://164.152.194.196:8000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
