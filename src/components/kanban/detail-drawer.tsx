"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetBody, SheetFooter, SheetHeader } from "@/components/ui/sheet";
import { ConnectionsPanel } from "@/components/connections-panel";
import { STATUS_LABELS, STATUS_ORDER, type Item, type ItemStatus, type ItemType } from "./types";

const TYPES: ItemType[] = ["task", "note", "file", "decision"];

export function ItemDetailDrawer({
  item,
  onClose,
  onSaved,
  onDeleted,
}: {
  item: Item | null;
  onClose: () => void;
  onSaved: (item: Item) => void;
  onDeleted: (itemId: string) => void;
}) {
  const open = !!item;
  const [title, setTitle] = React.useState("");
  const [content, setContent] = React.useState("");
  const [type, setType] = React.useState<ItemType>("task");
  const [status, setStatus] = React.useState<ItemStatus>("backlog");
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (item) {
      setTitle(item.title);
      setContent(item.content ?? "");
      setType(item.type);
      setStatus(item.status);
      setConfirmDelete(false);
      setError(null);
    }
  }, [item]);

  if (!item) return <Sheet open={open} onClose={onClose}>{null}</Sheet>;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, content: content || null, type, status }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      const json = (await res.json()) as { item: Item };
      onSaved(json.item);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      onDeleted(item.id);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title={item.title} onClose={onClose}>
        <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
          Created {new Date(item.createdAt).toLocaleString()}
          {item.createdByAgent && ` · by ${item.createdByAgent}`}
        </div>
      </SheetHeader>
      <SheetBody className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-[hsl(var(--muted-foreground))]">Title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={saving || deleting} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[hsl(var(--muted-foreground))]">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ItemType)}
              disabled={saving || deleting}
              className="h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 text-sm"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[hsl(var(--muted-foreground))]">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ItemStatus)}
              disabled={saving || deleting}
              className="h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 text-sm"
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[hsl(var(--muted-foreground))]">Content</label>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={saving || deleting}
            rows={8}
            placeholder="Markdown supported"
          />
        </div>

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Connections
          </h3>
          <ConnectionsPanel type="item" id={item.id} />
        </div>
      </SheetBody>
      <SheetFooter>
        {confirmDelete ? (
          <>
            <span className="text-xs text-[hsl(var(--muted-foreground))]">Delete this item?</span>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void remove()} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete item"
              onClick={() => setConfirmDelete(true)}
              disabled={saving}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
                Close
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={saving || !title.trim()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </>
        )}
      </SheetFooter>
    </Sheet>
  );
}
