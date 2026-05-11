import Link from "next/link";
import { Building2, Cable, KeyRound, RefreshCw } from "lucide-react";
import { ensureUserOrg } from "@/lib/org";

export default async function SettingsIndex() {
  const org = await ensureUserOrg();
  const items = [
    {
      href: "/settings/org",
      icon: Building2,
      title: "Organization",
      description: `${org.name} — rename, vault name, members (later)`,
    },
    {
      href: "/settings/connections",
      icon: Cable,
      title: "Connections",
      description: "Composio connections that feed this brain",
    },
    {
      href: "/settings/llm-keys",
      icon: KeyRound,
      title: "LLM API keys",
      description: "Anthropic + OpenAI keys for embeddings, filing, and chat",
    },
    {
      href: "/settings/sync",
      icon: RefreshCw,
      title: "Sync",
      description: "Auto-pull from Composio toolkits (Gmail, Drive, etc.)",
    },
  ];
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Settings</h1>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
          >
            <it.icon className="mt-0.5 h-5 w-5 text-zinc-500" />
            <div>
              <div className="font-medium">{it.title}</div>
              <div className="text-sm text-muted-foreground">{it.description}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
