"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { KanbanCard } from "./card";
import { STATUS_LABELS, type Item, type ItemStatus } from "./types";

export function KanbanColumn({
  status,
  items,
  onCardClick,
  onQuickAdd,
}: {
  status: ItemStatus;
  items: Item[];
  onCardClick: (item: Item) => void;
  onQuickAdd: (status: ItemStatus, title: string) => Promise<void>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { type: "column", status } });
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const submit = async () => {
    const title = draft.trim();
    if (!title) {
      setAdding(false);
      setDraft("");
      return;
    }
    setSubmitting(true);
    try {
      await onQuickAdd(status, title);
      setDraft("");
      setAdding(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 ${
        isOver ? "ring-2 ring-[hsl(var(--ring))]" : ""
      }`}
    >
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-3 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{STATUS_LABELS[status]}</h3>
          <span className="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
            {items.length}
          </span>
        </div>
        {!adding && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Add to ${STATUS_LABELS[status]}`}
            onClick={() => setAdding(true)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      <SortableContext id={status} items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2 p-2 min-h-16">
          {items.map((item) => (
            <KanbanCard key={item.id} item={item} onClick={() => onCardClick(item)} />
          ))}
        </div>
      </SortableContext>

      {adding && (
        <div className="border-t border-[hsl(var(--border))] p-2">
          <Input
            autoFocus
            value={draft}
            placeholder={`New ${STATUS_LABELS[status]} item…`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
              if (e.key === "Escape") {
                setAdding(false);
                setDraft("");
              }
            }}
            disabled={submitting}
          />
          <div className="mt-2 flex justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setDraft("");
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={() => void submit()} disabled={submitting || !draft.trim()}>
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
