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
