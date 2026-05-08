/**
 * Phase 8 v1 — OAuth 2.1 core utilities for /api/mcp.
 *
 * Implements the minimum viable OAuth surface needed for Claude.ai's
 * native Custom Connectors UI to connect to the brain without the
 * `mcp-remote` stdio bridge.
 *
 * Scope intentionally lean:
 *   - Authorization Code flow with PKCE (S256 only)
 *   - Manually-registered clients (no DCR yet)
 *   - Opaque random tokens (no JWT)
 *   - 30-day access token TTL, no refresh tokens (re-authorize when expired)
 *
 * Token validation lives in the MCP middleware (src/app/api/[transport]/route.ts);
 * issuance + verification primitives live here.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oauthAccessTokens, oauthAuthorizationCodes, oauthClients } from "@/lib/db/schema";

const ACCESS_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes — generous for slow consent

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

/**
 * Hash an OAuth client secret. Format: `<saltHex>:<hashHex>`. We use
 * scrypt (Node built-in) so there's no extra dependency.
 */
export function hashClientSecret(secret: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(secret, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `${salt}:${hash.toString("hex")}`;
}

export function verifyClientSecret(secret: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const computed = scryptSync(secret, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  const storedBuf = Buffer.from(hashHex, "hex");
  if (storedBuf.length !== computed.length) return false;
  return timingSafeEqual(computed, storedBuf);
}

export function generateOpaqueToken(prefix: string = ""): string {
  return prefix + randomBytes(32).toString("base64url");
}

/**
 * PKCE S256 verification. Per RFC 7636: the code_challenge stored at
 * /authorize must equal `BASE64URL(SHA256(code_verifier))` provided
 * at /token.
 */
export function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return computed === challenge;
}

export type ClientRecord = {
  id: string;
  clientId: string;
  name: string;
  redirectUris: string[];
};

export async function findClientById(clientId: string): Promise<ClientRecord | null> {
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    redirectUris: row.redirectUris,
  };
}

export async function authenticateClient(args: {
  clientId: string;
  clientSecret: string;
}): Promise<ClientRecord | null> {
  const [row] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, args.clientId))
    .limit(1);
  if (!row) return null;
  if (!verifyClientSecret(args.clientSecret, row.clientSecretHash)) return null;
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    redirectUris: row.redirectUris,
  };
}

export async function issueAuthorizationCode(args: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
}): Promise<string> {
  const code = generateOpaqueToken("ac_");
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_MS);
  await db.insert(oauthAuthorizationCodes).values({
    code,
    clientId: args.clientId,
    userId: args.userId,
    redirectUri: args.redirectUri,
    codeChallenge: args.codeChallenge,
    codeChallengeMethod: args.codeChallengeMethod,
    scope: args.scope,
    expiresAt,
  });
  return code;
}

export async function consumeAuthorizationCode(args: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ userId: string; scope: string } | { error: string }> {
  const [row] = await db
    .select()
    .from(oauthAuthorizationCodes)
    .where(eq(oauthAuthorizationCodes.code, args.code))
    .limit(1);
  if (!row) return { error: "invalid_grant: code not found" };
  if (row.used === "true") return { error: "invalid_grant: code already used" };
  if (row.expiresAt.getTime() < Date.now()) return { error: "invalid_grant: code expired" };
  if (row.clientId !== args.clientId) return { error: "invalid_grant: client_id mismatch" };
  if (row.redirectUri !== args.redirectUri) return { error: "invalid_grant: redirect_uri mismatch" };
  if (row.codeChallengeMethod !== "S256") return { error: "invalid_grant: only S256 PKCE supported" };
  if (!verifyPkce(args.codeVerifier, row.codeChallenge)) {
    return { error: "invalid_grant: PKCE verification failed" };
  }
  // Mark as used so it can't be replayed.
  await db
    .update(oauthAuthorizationCodes)
    .set({ used: "true" })
    .where(eq(oauthAuthorizationCodes.code, args.code));
  return { userId: row.userId, scope: row.scope };
}

export async function issueAccessToken(args: {
  clientId: string;
  userId: string;
  scope: string;
}): Promise<{ token: string; expiresIn: number; expiresAt: Date }> {
  const token = generateOpaqueToken("sb_at_");
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
  await db.insert(oauthAccessTokens).values({
    token,
    clientId: args.clientId,
    userId: args.userId,
    scope: args.scope,
    expiresAt,
  });
  return {
    token,
    expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    expiresAt,
  };
}

export type ValidatedToken = {
  userId: string;
  clientId: string;
  scope: string;
  expiresAt: Date;
};

/**
 * Look up an access token. Returns null if the token doesn't exist,
 * is expired, or has been revoked.
 */
export async function validateAccessToken(token: string): Promise<ValidatedToken | null> {
  const [row] = await db
    .select()
    .from(oauthAccessTokens)
    .where(
      and(
        eq(oauthAccessTokens.token, token),
        gt(oauthAccessTokens.expiresAt, new Date()),
        isNull(oauthAccessTokens.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    userId: row.userId,
    clientId: row.clientId,
    scope: row.scope,
    expiresAt: row.expiresAt,
  };
}
