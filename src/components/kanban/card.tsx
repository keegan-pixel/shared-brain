"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import type { Item } from "./types";

const TYPE_BADGE: Record<Item["type"], string> = {
  task: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  note: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  file: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  decision: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
};

export function KanbanCard({
  item,
  onClick,
}: {
  item: Item;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: "item", status: item.status },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2.5 shadow-sm",
        "cursor-grab active:cursor-grabbing",
        isDragging && "ring-1 ring-[hsl(var(--ring))]",
      )}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Suppress click during drag end / when dnd-kit sets isDragging
        if (isDragging) return;
        // Prevent click-through if the user starts dragging mid-click
        if (e.detail === 0) return;
        onClick();
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 text-sm font-medium leading-snug">{item.title}</div>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", TYPE_BADGE[item.type])}>
          {item.type}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-[hsl(var(--muted-foreground))]">
        <span>{new Date(item.updatedAt).toLocaleDateString()}</span>
        {item.createdByAgent && <span className="truncate">{item.createdByAgent}</span>}
      </div>
    </div>
  );
}
