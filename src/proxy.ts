import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// MCP and sync endpoints use Bearer-token auth, not Clerk session cookies.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/mcp",
  "/api/sse",
  "/api/message",
  "/api/sync(.*)",
  // Phase 8 v2 — daemon self-report endpoint (Bearer auth in the route).
  "/api/daemon/(.*)",
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
  // Phase 8 v2 MVP: DCR (RFC 7591) — public so new AI clients can self-register.
  "/api/register",
]);

// Routes that should NOT be rate-limited even though they're public.
// Sync routes can legitimately receive thousands of POSTs in a burst when a
// daemon does its initial scan (Richard had ~3,800 files); rate-limiting
// here would break the install flow. Sync is Bearer-auth'd so abuse risk
// is bounded by knowing a sync key.
const skipRateLimit = createRouteMatcher([
  "/api/sync(.*)",
  "/api/cron/(.*)",
  "/api/daemon/(.*)",
]);

// ────────────────────────────────────────────────────────────────────────
// In-memory rate limiter (defense against bot scanning on public routes).
//
// Limitation: Vercel's serverless model means each lambda instance has its
// own Map — state isn't shared across instances. For a sustained attack
// from a single IP, multiple lambda instances would each track that IP
// separately. This works as a SPEED BUMP, not a wall. Proper distributed
// rate-limiting needs Upstash/Vercel KV — see Outstanding Items roadmap.
//
// Shipped 2026-05-15 in response to 600k edge request spike — see
// [[Post-Mortem 2026-05-12 Jake's Install]] Part Three (when written).
// ────────────────────────────────────────────────────────────────────────

type RateLimitWindow = {
  count: number;
  resetAt: number;
};

const WINDOW_MS = 60_000; // 1-minute sliding window
const PUBLIC_LIMIT = 60; // 60 req/min/IP for unauthenticated routes
const AUTHED_LIMIT = 600; // 600 req/min/IP for authenticated routes

const buckets = new Map<string, RateLimitWindow>();
let lastCleanup = Date.now();

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return ip;
}

function checkRateLimit(ip: string, limit: number, scope: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const key = `${scope}:${ip}`;
  const bucket = buckets.get(key);

  // Lazy cleanup every 5 min to keep the Map from growing unbounded.
  if (now - lastCleanup > 5 * 60_000) {
    for (const [k, b] of buckets.entries()) {
      if (b.resetAt < now) buckets.delete(k);
    }
    lastCleanup = now;
  }

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count++;
  return { allowed: true, retryAfter: 0 };
}

function rateLimitResponse(retryAfter: number): NextResponse {
  return new NextResponse(
    JSON.stringify({
      error: "rate_limited",
      message: "Too many requests. Slow down.",
      retry_after_seconds: retryAfter,
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(retryAfter),
        "cache-control": "no-store",
      },
    },
  );
}

export default clerkMiddleware(async (auth, req) => {
  // Rate limiting runs BEFORE auth protection so we cap unauthenticated
  // scanner traffic. Authenticated requests get a much higher cap.
  if (!skipRateLimit(req)) {
    const ip = getClientIp(req);
    const isPublic = isPublicRoute(req);
    const limit = isPublic ? PUBLIC_LIMIT : AUTHED_LIMIT;
    const scope = isPublic ? "public" : "authed";
    const check = checkRateLimit(ip, limit, scope);
    if (!check.allowed) {
      return rateLimitResponse(check.retryAfter);
    }
  }

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
