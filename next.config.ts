import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Phase 8 v1 — expose OAuth discovery at the canonical RFC 8414
   * path (`/.well-known/oauth-authorization-server`) AND at the
   * MCP-spec-flavored protected-resource path. Next.js refuses to
   * route App Router directories that start with `.`, so we keep
   * the route handler under `/api/oauth-discovery/...` and rewrite
   * external paths into it.
   */
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/oauth-discovery/oauth-authorization-server",
      },
      {
        // Some MCP clients fetch a resource-suffixed metadata path.
        source: "/.well-known/oauth-authorization-server/:path*",
        destination: "/api/oauth-discovery/oauth-authorization-server",
      },
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/oauth-discovery/oauth-protected-resource",
      },
      {
        source: "/.well-known/oauth-protected-resource/:path*",
        destination: "/api/oauth-discovery/oauth-protected-resource",
      },
    ];
  },
};

export default nextConfig;
