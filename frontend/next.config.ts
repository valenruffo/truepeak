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
      // All other API requests proxied to backend
      {
        source: "/api/debug-backend",
        destination: "/api/debug-backend",
      },
      // Proxy label logos to backend
const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://164.152.194.196:8000";

// ...

      {
        source: "/logos/:path*",
        destination: `${backendUrl}/logos/:path*`,
      },
      // All other API requests proxied to backend
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
