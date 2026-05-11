"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

type Props = {
  userTag: string;
  vaultName: string;
  syncKey: string;
};

const APP_URL = "https://shared-brain-ecru.vercel.app";

export function DaemonInstallClient({ userTag, vaultName, syncKey }: Props) {
  const [revealed, setRevealed] = React.useState(false);
  const [vaultPath, setVaultPath] = React.useState("");
  const placeholder = vaultName
    ? `/Users/<you>/Documents/${vaultName}`
    : "/Users/<you>/Documents/MyVault";

  const installCommand = vaultPath
    ? `cd ~ && git clone https://github.com/keegan-pixel/shared-brain.git && cd shared-brain && npm install && cd agent && npm install && cd .. && npm run install-daemon -- --user-tag "${userTag}" --vault-path "${vaultPath}" --api-key "${syncKey}" --api-base "${APP_URL}"`
    : "(Fill in your vault path below to generate the command)";

  const maskedKey = revealed
    ? syncKey
    : syncKey
      ? `${syncKey.slice(0, 14)}…${syncKey.slice(-4)}`
      : "(no key set)";

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="font-medium">1. Sync key for this brain</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          The daemon uses this key to authenticate against the brain. Keep it
          secret — anyone with it can push files to your brain.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 break-all rounded bg-muted px-3 py-2 text-xs">
            {maskedKey}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRevealed((v) => !v)}
          >
            {revealed ? "Hide" : "Reveal"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigator.clipboard.writeText(syncKey)}
          >
            Copy
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="font-medium">2. Pick your vault folder</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          The full path to the folder you want synced. The daemon watches
          this folder + every subfolder.
        </p>
        <input
          className="mt-3 w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground dark:border-zinc-800"
          placeholder={placeholder}
          value={vaultPath}
          onChange={(e) => setVaultPath(e.target.value)}
        />
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="font-medium">3. Run this in Terminal</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          One-time install. Clones the repo, installs deps, registers a
          launchd service that auto-starts on every login. Logs to{" "}
          <code>/tmp/shared-brain-sync.{userTag}.log</code>.
        </p>
        <div className="relative mt-3">
          <pre className="overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100 dark:bg-zinc-950">
            <code>{installCommand}</code>
          </pre>
          {vaultPath && (
            <Button
              variant="outline"
              size="sm"
              className="absolute right-2 top-2"
              onClick={() => navigator.clipboard.writeText(installCommand)}
            >
              Copy
            </Button>
          )}
        </div>
        <ul className="mt-3 list-disc pl-5 text-xs text-muted-foreground">
          <li>
            Prerequisites: <code>git</code>, <code>node</code> (v20+), and{" "}
            <code>npm</code> installed. <code>brew install node</code> if not.
          </li>
          <li>
            After install: <code>launchctl list | grep shared-brain</code> to
            confirm it&rsquo;s running.
          </li>
          <li>
            To uninstall:{" "}
            <code>npm run install-daemon -- --user-tag {userTag} --uninstall</code>{" "}
            from the cloned repo.
          </li>
        </ul>
      </div>

      <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-xs text-muted-foreground dark:border-zinc-700 dark:bg-zinc-900">
        <strong>Cloud-only mode:</strong> If you don&rsquo;t keep work
        documents on this Mac, skip this step entirely. The brain works fine
        without the daemon — you&rsquo;ll just need to add content via Claude
        (which creates docs in the brain directly) or via Composio
        integrations (Gmail, Drive auto-sync).
      </div>
    </div>
  );
}
