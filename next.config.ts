import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ["denial-economist-baffling.ngrok-free.dev"],
  serverExternalPackages: ["@nimiq/core", "comlink", "websocket", "bufferutil", "utf-8-validate"],
  experimental: {
    optimizePackageImports: ["@nimiq/mini-app-sdk"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
