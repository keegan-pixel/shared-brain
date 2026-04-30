<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Shared Brain — agent rules

This is **Shared Brain**, an AI-native PM platform built as a personal tool
first and a ViaOps service offering second. Read `docs/spec.md` and
`docs/build-log.md` before writing code so you understand what's already
been built and where we are in the phased plan.

## Documentation rule (non-negotiable)

**After every milestone — before you consider the work "done" — update
documentation in BOTH places:**

1. **Vault (canonical):** `~/Documents/ViaOps/Knowledge/Frameworks/Shared Brain/`
   - `Build Log.md` — append a phase section, update the status table at the
     top
   - `Decisions.md` — add an ADR entry for any non-obvious choice
   - `Runbook.md` — add new ops procedures discovered while building
2. **Repo (mirror):** `docs/` in this repo
   - Mirror the four files from the vault: `build-log.md`, `decisions.md`,
     `runbook.md`, `spec.md`
3. **Spec (`docs/spec.md` + the canonical vault copy):**
   - Mark completed checkboxes
   - Update the status snapshot table at the top
   - Note divergences with links to the relevant ADR

Then commit with a `docs:` prefix.

A milestone = (a) finishing a phase, (b) shipping a non-trivial feature, or
(c) making a decision worth recording. When in doubt, update.

When Phase 2's vault sync agent ships, repo `docs/` will be auto-mirrored
from the vault. Until then, do it by hand.

## Engineering style

- TypeScript strict, no `any`, no `@ts-ignore`. Use Zod for input validation
  at every boundary (API route, MCP tool, etc.).
- Every write to the database must log to `activity_feed` via
  `logActivity()` from `src/lib/activity.ts`.
- Every query that takes an ID from a client must verify org scope with
  `assertSpaceInOrg`, `assertProjectInOrg`, or equivalent. Never trust the
  client.
- Commit messages narrate *why*, not just *what*. Use Conventional Commits
  (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
- Never delete a `.next` cache while a dev server is running.

## Quick links

- Live app: https://shared-brain-ecru.vercel.app/
- Repo: https://github.com/keegan-pixel/shared-brain
- Vault docs: `~/Documents/ViaOps/Knowledge/Frameworks/Shared Brain/`
- Repo docs: `./docs/`
- Spec: `./docs/spec.md`
