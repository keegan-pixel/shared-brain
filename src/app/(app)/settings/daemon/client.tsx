"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";

type Props = {
  userTag: string;
  vaultName: string;
  syncKey: string;
};

const APP_URL = "https://shared-brain-ecru.vercel.app";

export function DaemonInstallClient({ userTag, vaultName, syncKey }: Props) {
  const [revealed, setRevealed] = React.useState(false);
  // Multi-folder support: user can add as many vault paths as they want.
  // First one is the primary; additional paths get appended via --extra-vault-path
  // (a flag the daemon parses into multiple watch targets).
  const [vaultPaths, setVaultPaths] = React.useState<string[]>([""]);
  const vaultPath = vaultPaths[0] ?? "";
  const extraPaths = vaultPaths.slice(1).filter((p) => p.trim());
  const placeholder = vaultName
    ? `/Users/<you>/Documents/${vaultName}`
    : "/Users/<you>/Documents/MyVault";

  const extraFlags = extraPaths.map((p) => `--extra-vault-path "${p}"`).join(" ");
  const installCommand = vaultPath
    ? [
        // Check node exists + is v20+; bail with a friendly message if not.
        `command -v node >/dev/null 2>&1 || { echo "Node not installed. Install with: brew install node"; exit 1; }`,
        `node -e "process.exit(parseInt(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" || { echo "Node $(node --version) is too old; need v20+. Upgrade with: brew upgrade node"; exit 1; }`,
        // Clone + install + register the daemon.
        `cd ~`,
        `git clone https://github.com/keegan-pixel/shared-brain.git 2>/dev/null || (cd shared-brain && git pull)`,
        `cd shared-brain`,
        `npm install`,
        `(cd agent && npm install)`,
        `npm run install-daemon -- --user-tag "${userTag}" --vault-path "${vaultPath}" ${extraFlags} --api-key "${syncKey}" --api-base "${APP_URL}"`,
      ].join(" && \\\n  ")
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
          <CopyButton text={syncKey} disabled={!syncKey} />
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="font-medium">2. Pick your vault folder(s)</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Full absolute path(s) to folders you want synced. The daemon
          watches each folder + every subfolder. Add multiple if your work
          lives in more than one place.
        </p>
        {vaultPaths.length > 1 && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
            <strong>Note:</strong> for now the daemon watches the first folder
            fully. Additional folders are passed through to the config and
            will be live-watched in the next update (v2.1).
          </p>
        )}
        <div className="mt-3 space-y-2">
          {vaultPaths.map((path, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="flex-1 rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground dark:border-zinc-800"
                placeholder={i === 0 ? placeholder : "/Users/<you>/Documents/AnotherFolder"}
                value={path}
                onChange={(e) => {
                  const next = [...vaultPaths];
                  next[i] = e.target.value;
                  setVaultPaths(next);
                }}
              />
              {vaultPaths.length > 1 && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setVaultPaths(vaultPaths.filter((_, j) => j !== i))}
                  aria-label="Remove folder"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => setVaultPaths([...vaultPaths, ""])}
        >
          <Plus className="h-3 w-3" /> Add another folder
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">
          <strong>Why typing?</strong> Web browsers can&rsquo;t open native
          file pickers for security reasons — they only see files you
          explicitly drag in, not folder paths. To find a folder&rsquo;s
          absolute path: open Finder → right-click the folder → Get Info →
          look for &ldquo;Where:&rdquo; → copy that line. Or in Terminal:
          <code className="ml-1 rounded bg-muted px-1">cd /path/to/folder && pwd</code>.
        </p>
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
            <CopyButton
              text={installCommand}
              className="absolute right-2 top-2"
            />
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
