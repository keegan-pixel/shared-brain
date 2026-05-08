/**
 * Phase 8 v1 — OAuth Authorization endpoint (consent page).
 *
 * Server component. Clerk middleware ensures the user is signed in
 * before this renders. Validates client_id + redirect_uri + PKCE
 * params, then shows a consent form. Submission goes through a
 * server action that issues an auth code and 302s to the client's
 * redirect_uri with `code` + `state`.
 *
 * Path: /authorize (top-level, NOT under /api). claude.ai's Custom
 * Connectors uses a hardcoded `/authorize` path for the AS, regardless
 * of what `authorization_endpoint` says in the discovery doc.
 */

import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/org";
import { findClientById, issueAuthorizationCode } from "@/lib/oauth/core";
import { Button } from "@/components/ui/button";

type SearchParams = {
  client_id?: string;
  redirect_uri?: string;
  response_type?: string;
  state?: string;
  scope?: string;
  code_challenge?: string;
  code_challenge_method?: string;
};

function errorPage(title: string, detail: string) {
  return (
    <div className="mx-auto mt-20 max-w-lg rounded-lg border border-red-300 bg-red-50 p-6">
      <h1 className="text-xl font-semibold text-red-900">{title}</h1>
      <p className="mt-2 text-sm text-red-800">{detail}</p>
    </div>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const userId = await requireUserId();

  // Validate required params per RFC 6749 + RFC 7636.
  const clientId = params.client_id?.trim();
  const redirectUri = params.redirect_uri?.trim();
  const responseType = params.response_type?.trim();
  const codeChallenge = params.code_challenge?.trim();
  const codeChallengeMethod = (params.code_challenge_method ?? "S256").trim();
  const state = params.state ?? "";
  const scope = params.scope?.trim() ?? "mcp";

  if (!clientId) return errorPage("Missing client_id", "The OAuth request is missing the client_id parameter.");
  if (!redirectUri) return errorPage("Missing redirect_uri", "The OAuth request is missing the redirect_uri parameter.");
  if (responseType !== "code") {
    return errorPage("Unsupported response_type", `Only 'code' is supported. Got: ${responseType}`);
  }
  if (!codeChallenge) {
    return errorPage("PKCE required", "code_challenge parameter is required (PKCE is mandatory).");
  }
  if (codeChallengeMethod !== "S256") {
    return errorPage("Unsupported code_challenge_method", "Only S256 is supported.");
  }

  const client = await findClientById(clientId);
  if (!client) {
    return errorPage("Unknown client", `No OAuth client registered with id '${clientId}'.`);
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return errorPage(
      "redirect_uri not allowed",
      `The redirect_uri '${redirectUri}' is not in this client's allow-list. Contact the brain administrator to register it.`,
    );
  }

  async function approve(formData: FormData) {
    "use server";
    const _userId = await requireUserId();
    const cId = String(formData.get("clientId") ?? "");
    const rUri = String(formData.get("redirectUri") ?? "");
    const cChallenge = String(formData.get("codeChallenge") ?? "");
    const cMethod = String(formData.get("codeChallengeMethod") ?? "S256");
    const sc = String(formData.get("scope") ?? "mcp");
    const st = String(formData.get("state") ?? "");

    const code = await issueAuthorizationCode({
      clientId: cId,
      userId: _userId,
      redirectUri: rUri,
      codeChallenge: cChallenge,
      codeChallengeMethod: cMethod,
      scope: sc,
    });

    const target = new URL(rUri);
    target.searchParams.set("code", code);
    if (st) target.searchParams.set("state", st);
    redirect(target.toString());
  }

  async function deny(formData: FormData) {
    "use server";
    const rUri = String(formData.get("redirectUri") ?? "");
    const st = String(formData.get("state") ?? "");
    const target = new URL(rUri);
    target.searchParams.set("error", "access_denied");
    target.searchParams.set("error_description", "User denied the authorization request.");
    if (st) target.searchParams.set("state", st);
    redirect(target.toString());
  }

  return (
    <div className="mx-auto mt-12 max-w-lg rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h1 className="text-2xl font-semibold">Connect {client.name}?</h1>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        <span className="font-medium">{client.name}</span> is requesting access
        to your Shared Brain.
      </p>

      <div className="mt-6 rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-zinc-700 dark:text-zinc-300">
          You are signed in as
        </div>
        <code className="mt-1 block break-all text-xs text-zinc-500">{userId}</code>
        <div className="mt-3 text-zinc-700 dark:text-zinc-300">
          Scope requested
        </div>
        <code className="mt-1 block text-xs text-zinc-500">{scope}</code>
        <div className="mt-3 text-zinc-700 dark:text-zinc-300">
          Redirect URI
        </div>
        <code className="mt-1 block break-all text-xs text-zinc-500">{redirectUri}</code>
      </div>

      <p className="mt-4 text-xs text-zinc-500">
        Approving will issue a 30-day access token to {client.name}. You can
        revoke access at any time from your settings page.
      </p>

      <div className="mt-6 flex gap-3">
        <form action={approve} className="flex-1">
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="redirectUri" value={redirectUri} />
          <input type="hidden" name="codeChallenge" value={codeChallenge} />
          <input type="hidden" name="codeChallengeMethod" value={codeChallengeMethod} />
          <input type="hidden" name="scope" value={scope} />
          <input type="hidden" name="state" value={state} />
          <Button type="submit" className="w-full">Approve</Button>
        </form>
        <form action={deny} className="flex-1">
          <input type="hidden" name="redirectUri" value={redirectUri} />
          <input type="hidden" name="state" value={state} />
          <Button type="submit" variant="outline" className="w-full">Deny</Button>
        </form>
      </div>
    </div>
  );
}
