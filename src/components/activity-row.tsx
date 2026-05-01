import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  actionLabel,
  actorBadgeClass,
  entityLink,
  relativeTime,
} from "@/lib/activity-display";

export type ActivityEntry = {
  id: string;
  orgId: string;
  actorAgent: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string | Date;
};

export function ActivityRow({ entry, compact = false }: { entry: ActivityEntry; compact?: boolean }) {
  const href = entityLink(entry);
  const inner = (
    <div
      className={cn(
        "flex items-start gap-3 px-3",
        compact ? "py-1.5" : "py-2.5",
        "hover:bg-[hsl(var(--accent))]",
      )}
    >
      <span
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
          actorBadgeClass(entry.actorAgent),
        )}
        title={`actor: ${entry.actorAgent}`}
      >
        {entry.actorAgent}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {actionLabel(entry.action)}
          </span>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">·</span>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
            {relativeTime(entry.createdAt)}
          </span>
        </div>
        <div className={cn("text-sm leading-snug", !compact && "mt-0.5")}>{entry.summary}</div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : <div>{inner}</div>;
}
