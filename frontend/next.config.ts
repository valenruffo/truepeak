import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [],
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://164.152.194.196:8000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
