"use client";

import * as React from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActivityEntry } from "@/components/activity-row";
import { ActivityRow } from "@/components/activity-row";

const POLL_MS = 15000;
const STORAGE_KEY = "shared-brain.activity.lastSeen";

export function ActivityBell() {
  const [entries, setEntries] = React.useState<ActivityEntry[]>([]);
  const [open, setOpen] = React.useState(false);
  const [unread, setUnread] = React.useState(0);
  const [lastSeen, setLastSeen] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // Hydrate lastSeen on mount.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    setLastSeen(window.localStorage.getItem(STORAGE_KEY));
  }, []);

  // Poll for the latest 25 entries.
  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const res = await fetch(`/api/activity?limit=25`, { cache: "no-store" });
        if (!res.ok) return schedule();
        const json = (await res.json()) as { entries: ActivityEntry[] };
        if (cancelled) return;
        setEntries(json.entries);
      } catch {
        // network blip — retry next tick
      }
      schedule();
    };
    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Compute unread count whenever entries or lastSeen change.
  React.useEffect(() => {
    if (!lastSeen) {
      setUnread(entries.length);
      return;
    }
    const lastSeenMs = new Date(lastSeen).getTime();
    const count = entries.filter((e) => new Date(e.createdAt).getTime() > lastSeenMs).length;
    setUnread(count);
  }, [entries, lastSeen]);

  // Close popover on outside click.
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  const markAllSeen = () => {
    const now = new Date().toISOString();
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, now);
    setLastSeen(now);
  };

  const onToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) markAllSeen();
  };

  return (
    <div ref={containerRef} className="relative">
      <Button variant="ghost" size="icon" aria-label="Activity feed" onClick={onToggle}>
        <Activity className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-96 overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-lg">
          <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-3 py-2">
            <h3 className="text-sm font-semibold">Recent activity</h3>
            <Link
              href="/activity"
              className="text-xs text-[hsl(var(--muted-foreground))] hover:underline"
              onClick={() => setOpen(false)}
            >
              View all →
            </Link>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {entries.length === 0 ? (
              <div className="p-3 text-xs text-[hsl(var(--muted-foreground))]">
                Loading...
              </div>
            ) : (
              <ul className="divide-y divide-[hsl(var(--border))]">
                {entries.slice(0, 12).map((e) => (
                  <li key={e.id}>
                    <ActivityRow entry={e} compact />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
