"use client";

import { GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { TYPE_ACCENT, TYPE_BADGE } from "./colors";
import type { Item } from "./types";

/**
 * Static card body used inside <DragOverlay>. No sortable wiring — it just
 * renders the same visual at the cursor while a drag is in flight.
 */
export function KanbanCardOverlay({ item }: { item: Item }) {
  return (
    <div className="flex w-80 cursor-grabbing overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg ring-1 ring-[hsl(var(--ring))]">
      <div className={cn("w-1 shrink-0", TYPE_ACCENT[item.type])} aria-hidden="true" />
      <div className="flex w-6 shrink-0 items-center justify-center text-[hsl(var(--muted-foreground))]">
        <GripVertical className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 p-2.5 pl-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 text-sm font-medium leading-snug">{item.title}</div>
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
              TYPE_BADGE[item.type],
            )}
          >
            {item.type}
          </span>
        </div>
      </div>
    </div>
  );
}

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
    // While the DragOverlay handles the visual at the cursor, fade the
    // original card to a placeholder so the user can see where it'd insert.
    opacity: isDragging ? 0.25 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm transition-shadow hover:shadow-md",
        isDragging && "ring-1 ring-[hsl(var(--ring))]",
      )}
    >
      {/* Type accent stripe down the left edge. */}
      <div className={cn("w-1 shrink-0", TYPE_ACCENT[item.type])} aria-hidden="true" />

      {/* Drag handle — only this is sortable; the rest of the card is a normal click target. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to move card"
        className="flex w-6 shrink-0 cursor-grab items-center justify-center text-[hsl(var(--muted-foreground))]/40 hover:text-[hsl(var(--muted-foreground))] active:cursor-grabbing"
        // Stop click from bubbling so it doesn't open the drawer.
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Click target — full card body opens the detail drawer. */}
      <button
        type="button"
        onClick={onClick}
        className="min-w-0 flex-1 cursor-pointer p-2.5 pl-0 text-left"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 text-sm font-medium leading-snug">{item.title}</div>
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
              TYPE_BADGE[item.type],
            )}
          >
            {item.type}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-[hsl(var(--muted-foreground))]">
          <span>{new Date(item.updatedAt).toLocaleDateString()}</span>
          {item.createdByAgent && <span className="truncate pl-2">{item.createdByAgent}</span>}
        </div>
      </button>
    </div>
  );
}
