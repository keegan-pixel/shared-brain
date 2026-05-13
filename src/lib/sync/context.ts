/**
 * Sync context constants.
 *
 * Historical note: this module used to export a `resolveSyncOrg()` helper
 * with a module-level cache. That helper resolved sync requests to a
 * single "default org" — the same Keegan-as-only-test-user pattern that
 * caused the per-user MCP context leak (see ADR-038 / Jake's post-mortem
 * bug #16). The helper was dead code after Phase 8 v2 MVP Build D
 * shipped `requireSyncAuth(req)` (per-org sync keys) but lived on as
 * an imported-but-unused footgun.
 *
 * Deleted 2026-05-12 (Track 1 audit). All sync routes now resolve org
 * via `requireSyncAuth(req)` which keys off the request's sync key.
 */

export const SYNC_ACTOR = "vault-sync";
