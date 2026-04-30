"use client";

import * as React from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { KanbanColumn } from "./column";
import { KanbanCardOverlay } from "./card";
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
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [originalStatus, setOriginalStatus] = React.useState<ItemStatus | null>(null);
  // Track whether a drag is currently in flight so polling doesn't clobber
  // the optimistic cross-container moves we apply during onDragOver.
  const draggingRef = React.useRef(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const storageKey = `shared-brain.kanban.collapsed.${projectId}`;
  const [collapsed, setCollapsed] = React.useState<Set<ItemStatus>>(new Set());

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

  // Polling for AI / sync-driven changes. Pauses while the tab is hidden and
  // while the user is actively dragging (so we don't clobber the optimistic
  // cross-container state from onDragOver).
  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (document.hidden || draggingRef.current) return scheduleNext();
      try {
        const res = await fetch(`/api/items?projectId=${projectId}`, { cache: "no-store" });
        if (!res.ok) return scheduleNext();
        const json = (await res.json()) as { items: Item[] };
        if (cancelled || draggingRef.current) return;
        setItems(json.items);
      } catch {
        // network blip — retry on next tick
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

  /**
   * For a given dnd-kit id, figure out which column (status) it belongs to.
   * Column ids are the status enum values themselves. Card ids resolve via
   * the items list.
   */
  const findStatusForId = React.useCallback(
    (id: string): ItemStatus | null => {
      if ((STATUS_ORDER as readonly string[]).includes(id)) return id as ItemStatus;
      const item = items.find((i) => i.id === id);
      return item?.status ?? null;
    },
    [items],
  );

  // Collision detection: prefer the droppable the pointer is actually inside,
  // fall back to rect intersection for the case where the cursor briefly
  // leaves all droppables (e.g. between columns).
  const collisionDetection: CollisionDetection = React.useCallback((args) => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) return pointer;
    return rectIntersection(args);
  }, []);

  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setActiveId(id);
    setActive(null); // close detail drawer if open
    setOriginalStatus(item.status);
    draggingRef.current = true;
  };

  const onDragOver = (event: DragOverEvent) => {
    const { active: dragged, over } = event;
    if (!over) return;
    const draggedId = String(dragged.id);
    const overId = String(over.id);
    if (draggedId === overId) return;

    const targetStatus = findStatusForId(overId);
    if (!targetStatus) return;

    setItems((prev) => {
      const me = prev.find((i) => i.id === draggedId);
      if (!me || me.status === targetStatus) return prev;
      return prev.map((i) => (i.id === draggedId ? { ...i, status: targetStatus } : i));
    });
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const draggedId = String(event.active.id);
    const original = originalStatus;

    // Reset drag state regardless of outcome so the UI unblocks.
    setActiveId(null);
    setOriginalStatus(null);
    // Allow polling to resume after a small grace window (lets the PATCH
    // round-trip complete first so the next poll sees the new server state).
    setTimeout(() => {
      draggingRef.current = false;
    }, 500);

    const finalItem = items.find((i) => i.id === draggedId);
    if (!finalItem || !original) return;
    if (finalItem.status === original) return; // no-op move within the same column

    try {
      const res = await fetch(`/api/items/${draggedId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: finalItem.status }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
      const json = (await res.json()) as { item: Item };
      setItems((prev) => prev.map((i) => (i.id === draggedId ? json.item : i)));
    } catch {
      // Revert to the original column on failure.
      setItems((prev) =>
        prev.map((i) => (i.id === draggedId ? { ...i, status: original } : i)),
      );
    }
  };

  const onDragCancel = () => {
    // User pressed Esc or the drag was aborted — revert the optimistic move.
    if (activeId && originalStatus) {
      const id = activeId;
      const status = originalStatus;
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    }
    setActiveId(null);
    setOriginalStatus(null);
    setTimeout(() => {
      draggingRef.current = false;
    }, 200);
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

  const activeItem = activeId ? items.find((i) => i.id === activeId) ?? null : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
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

        <DragOverlay dropAnimation={{ duration: 180 }}>
          {activeItem ? <KanbanCardOverlay item={activeItem} /> : null}
        </DragOverlay>
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
