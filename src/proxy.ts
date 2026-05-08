import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// MCP and sync endpoints use Bearer-token auth, not Clerk session cookies.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/mcp",
  "/api/sse",
  "/api/message",
  "/api/sync(.*)",
  // Phase 6: serves Profile.md to MCP clients (Bearer auth in the route).
  "/api/operating-instructions",
  // Phase 4b: cron endpoint for background AI edges (CRON_SECRET / MCP_API_KEY).
  "/api/cron/(.*)",
  // MCP Reliability Hardening: public health endpoint (read-only, no PII).
  "/api/status",
  // Phase 8 v1: OAuth discovery + token endpoints (public per RFC 8414/6749).
  // /authorize is intentionally NOT public — it requires a Clerk session.
  // The .well-known/* paths rewrite to /api/oauth-discovery/* (Next can't
  // route directories starting with `.`).
  "/api/oauth-discovery/(.*)",
  "/.well-known/oauth-authorization-server(.*)",
  "/.well-known/oauth-protected-resource(.*)",
  "/api/oauth/token",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
