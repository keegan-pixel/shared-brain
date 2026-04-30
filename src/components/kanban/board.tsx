"use client";

import * as React from "react";
import {
  DndContext,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { KanbanColumn } from "./column";
import { ItemDetailDrawer } from "./detail-drawer";
import { STATUS_ORDER, type Item, type ItemStatus } from "./types";

const POLL_INTERVAL_MS = 3000;

export function KanbanBoard({
  projectId,
  initialItems,
}: {
  projectId: string;
  initialItems: Item[];
}) {
  const [items, setItems] = React.useState<Item[]>(initialItems);
  const [active, setActive] = React.useState<Item | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Per-project collapse state, persisted to localStorage so layout sticks
  // across reloads. Default: all expanded.
  const storageKey = `shared-brain.kanban.collapsed.${projectId}`;
  const [collapsed, setCollapsed] = React.useState<Set<ItemStatus>>(new Set());

  // Hydrate from localStorage on mount only.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ItemStatus[];
      setCollapsed(new Set(parsed.filter((s) => STATUS_ORDER.includes(s))));
    } catch {
      // bad JSON or storage disabled — ignore
    }
  }, [storageKey]);

  const toggleCollapse = React.useCallback(
    (status: ItemStatus) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(status)) next.delete(status);
        else next.add(status);
        try {
          window.localStorage.setItem(storageKey, JSON.stringify([...next]));
        } catch {
          // storage disabled — fine, just don't persist
        }
        return next;
      });
    },
    [storageKey],
  );

  // Group items into columns whenever the items array changes.
  const grouped = React.useMemo(() => {
    const out: Record<ItemStatus, Item[]> = {
      backlog: [],
      not_started: [],
      research_planning: [],
      in_progress: [],
      review: [],
      completed: [],
    };
    for (const it of items) out[it.status].push(it);
    return out;
  }, [items]);

  // Polling for AI / sync-driven changes. Runs at 3s; pauses when
  // tab is hidden so we don't burn requests for nothing.
  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (document.hidden) return scheduleNext();
      try {
        const res = await fetch(`/api/items?projectId=${projectId}`, { cache: "no-store" });
        if (!res.ok) return scheduleNext();
        const json = (await res.json()) as { items: Item[] };
        if (cancelled) return;
        setItems((prev) => mergePreservingActiveDrag(prev, json.items));
      } catch {
        // Network blip — try again on next interval.
      }
      scheduleNext();
    };
    const scheduleNext = () => {
      if (cancelled) return;
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId]);

  const onDragEnd = async (event: DragEndEvent) => {
    const { active: dragged, over } = event;
    if (!over) return;

    const item = items.find((i) => i.id === dragged.id);
    if (!item) return;

    // Drop target can be either a column id (status) or another card id.
    const overData = over.data.current as { type?: string; status?: ItemStatus } | undefined;
    const dropStatus =
      overData?.type === "column"
        ? overData.status
        : (items.find((i) => i.id === over.id)?.status ?? null);

    if (!dropStatus || dropStatus === item.status) return;

    // Optimistic update.
    const before = items;
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: dropStatus, updatedAt: new Date() } : i)),
    );

    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: dropStatus }),
      });
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
      const json = (await res.json()) as { item: Item };
      setItems((prev) => prev.map((i) => (i.id === item.id ? json.item : i)));
    } catch {
      // Revert on failure.
      setItems(before);
    }
  };

  const quickAdd = async (status: ItemStatus, title: string) => {
    const res = await fetch(`/api/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, type: "task", title, status }),
    });
    if (!res.ok) return;
    const json = (await res.json()) as { item: Item };
    setItems((prev) => [...prev, json.item]);
  };

  const handleSaved = (updated: Item) =>
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));

  const handleDeleted = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        {/* Outer wrapper handles horizontal scroll; inner row uses min-w-max
            so the columns don't try to fit into the page's width. The
            negative side margins make the scrollable area span the full
            inner width of the page padding. */}
        <div className="-mx-6 overflow-x-auto px-6 pb-4">
          <div className="flex min-w-max gap-3">
            {STATUS_ORDER.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                items={grouped[status]}
                collapsed={collapsed.has(status)}
                onToggleCollapse={toggleCollapse}
                onCardClick={setActive}
                onQuickAdd={quickAdd}
              />
            ))}
          </div>
        </div>
      </DndContext>
      <ItemDetailDrawer
        item={active}
        onClose={() => setActive(null)}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />
    </>
  );
}

/**
 * When the polling response comes back while the user is mid-drag we don't
 * want to clobber their optimistic state. For the simple case (no drag in
 * flight), just take the server view; otherwise leave local state alone.
 * dnd-kit doesn't expose an "is anything currently dragging" flag from
 * outside, so we do a lighter heuristic: prefer server data, but if any
 * item id changed status both ways within a 5-second window, the optimistic
 * write hasn't landed yet and we keep ours. Simpler approach for MVP: just
 * prefer server. Adjust if drag corruption shows up.
 */
function mergePreservingActiveDrag(_prev: Item[], next: Item[]): Item[] {
  return next;
}
