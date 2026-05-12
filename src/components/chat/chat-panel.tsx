"use client";

import * as React from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { usePathname } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, KeyRound, Send, Square, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetBody, SheetFooter, SheetHeader } from "@/components/ui/sheet";
import { useChatPanel } from "./chat-context";
import type { UIMessage } from "ai";

const STORAGE_KEY = "shared-brain.chat.messages";

/**
 * Best-effort context derived from the current URL. Backend uses this to
 * help Claude answer "what page am I on?" or "this thing" references.
 */
function deriveContext(pathname: string | null) {
  if (!pathname) return undefined;
  const m = pathname.match(/^\/(wiki|spaces|projects|activity)(?:\/([^/]+))?/);
  if (!m) return { kind: "home" as const, path: pathname };
  const [, route, id] = m;
  const map: Record<string, "wiki" | "wiki-detail" | "space" | "project" | "activity"> = {
    wiki: id ? "wiki-detail" : "wiki",
    spaces: "space",
    projects: "project",
    activity: "activity",
  };
  const kind = id ? map[route] : route === "wiki" ? "wiki" : "other";
  return { kind: kind as never, path: pathname, id };
}

/**
 * Phase 8 v2 MVP — the chat panel is gated on an Anthropic key being
 * configured for the user's org. Without it, hitting send would either
 * 400 (good) or silently use Keegan's env-var key (bad, gets him
 * billed for Jake's chat tokens). Render a CTA pointing at
 * /settings/llm-keys instead.
 */
function useHasAnthropicKey(): { loading: boolean; hasKey: boolean } {
  const [state, setState] = React.useState({ loading: true, hasKey: false });
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/orgs/llm-keys");
        if (!res.ok) {
          if (!cancelled) setState({ loading: false, hasKey: false });
          return;
        }
        const data = (await res.json()) as { keys?: Array<{ provider: string }> };
        const hasAnthropic = (data.keys ?? []).some((k) => k.provider === "anthropic");
        if (!cancelled) setState({ loading: false, hasKey: hasAnthropic });
      } catch {
        if (!cancelled) setState({ loading: false, hasKey: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export function ChatPanel() {
  const { open, setOpen } = useChatPanel();
  const pathname = usePathname();
  const { loading: keyLoading, hasKey } = useHasAnthropicKey();

  // Hydrate persisted messages on mount.
  const [initialMessages] = React.useState<UIMessage[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as UIMessage[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const { messages, sendMessage, status, stop, setMessages, error } = useChat({
    messages: initialMessages,
  });

  // Persist on every change.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // storage full / disabled — ignore
    }
  }, [messages]);

  const [input, setInput] = React.useState("");
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages / streaming chunks.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  // Focus input when the panel opens.
  React.useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [open]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || status === "streaming" || status === "submitted") return;
    void sendMessage(
      { text },
      { body: { context: { page: deriveContext(pathname) } } },
    );
    setInput("");
  };

  const clearChat = () => {
    setMessages([]);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  };

  return (
    <Sheet open={open} onClose={() => setOpen(false)} className="max-w-lg">
      <SheetHeader title="Claude — Shared Brain" onClose={() => setOpen(false)}>
        <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
          {messages.length === 0 ? "Say hi or ask anything about your workspace" : `${messages.length} messages`}
        </div>
      </SheetHeader>

      <SheetBody className="space-y-3">
        <div ref={scrollRef} className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
          {keyLoading ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Loading…
            </div>
          ) : !hasKey ? (
            <NoKeyState />
          ) : messages.length === 0 ? (
            <EmptyState />
          ) : (
            messages.map((m) => <Message key={m.id} message={m} />)
          )}
          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error.message}
            </div>
          )}
        </div>
      </SheetBody>

      <SheetFooter>
        <div className="w-full">
          <div className="flex gap-2">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={hasKey ? "Ask Claude…" : "Add an LLM API key first"}
              rows={2}
              className="resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (hasKey) handleSend();
                }
              }}
              disabled={!hasKey || status === "streaming" || status === "submitted"}
            />
            {status === "streaming" || status === "submitted" ? (
              <Button size="icon" variant="outline" onClick={() => stop()} aria-label="Stop">
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!hasKey || !input.trim()}
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
              ⏎ to send · ⇧⏎ for newline
            </span>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clearChat}
                className="inline-flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))] hover:underline"
              >
                <Trash2 className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
        </div>
      </SheetFooter>
    </Sheet>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-[hsl(var(--muted-foreground))]">
      <Bot className="h-8 w-8 text-[hsl(var(--muted-foreground))]/50" />
      <div className="font-medium">Claude is connected to your workspace.</div>
      <div className="max-w-72 leading-relaxed">
        Try: <em>&ldquo;What&rsquo;s on my plate this week?&rdquo;</em> · <em>&ldquo;Move the Phase 5b task to in_progress.&rdquo;</em> · <em>&ldquo;Search my wiki for &lsquo;APEX&rsquo;.&rdquo;</em>
      </div>
    </div>
  );
}

function NoKeyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-xs">
      <div className="rounded-full bg-amber-100 p-3 dark:bg-amber-900/30">
        <KeyRound className="h-6 w-6 text-amber-600 dark:text-amber-400" />
      </div>
      <div className="font-medium text-foreground">
        Add an LLM API key to use chat
      </div>
      <div className="max-w-72 leading-relaxed text-muted-foreground">
        The brain doesn&rsquo;t pay for chat tokens — you do. Paste an
        Anthropic key and we&rsquo;ll unlock the chat panel.
      </div>
      <Link
        href="/settings/llm-keys"
        className="mt-1 inline-flex items-center rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Set up keys →
      </Link>
    </div>
  );
}

function Message({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"
            : "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
        }`}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div
        className={`min-w-0 max-w-[88%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "bg-[hsl(var(--secondary))]/40"
            : "bg-[hsl(var(--card))] border border-[hsl(var(--border))]"
        }`}
      >
        {message.parts.map((part, idx) => {
          if (part.type === "text") {
            return (
              <div key={idx} className="markdown-body chat-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
              </div>
            );
          }
          // Tool calls and results — render as compact metadata pills so the user
          // can see which tools Claude used without it dominating the message.
          // For dynamic tools (Composio over MCP), AI SDK uses `dynamic-tool` parts
          // with the toolName in `part.toolName`.
          const isStaticTool = part.type.startsWith("tool-");
          const isDynamicTool = part.type === "dynamic-tool";
          if (isStaticTool || isDynamicTool) {
            const toolName: string = isDynamicTool
              ? ((part as { toolName?: string }).toolName ?? "tool")
              : part.type.replace(/^tool-/, "");
            // @ts-expect-error AI SDK union narrowing is loose here
            const state: string = part.state ?? "running";
            // @ts-expect-error AI SDK union narrowing is loose here
            const output = part.output;
            // @ts-expect-error AI SDK union narrowing is loose here
            const errorText: string | undefined = part.errorText ?? (typeof output === "object" && output && "error" in output ? String(output.error) : undefined);
            const isError = state === "output-error" || !!errorText;
            return (
              <div key={idx} className="my-1 flex flex-col gap-1">
                <div
                  className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] ${
                    isError
                      ? "bg-red-900/30 text-red-300"
                      : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
                  }`}
                >
                  <code>{toolName}</code>
                  <span>·</span>
                  <span>
                    {state === "output-available"
                      ? "✓"
                      : state === "input-available"
                        ? "running"
                        : state}
                  </span>
                </div>
                {isError && errorText && (
                  <pre className="whitespace-pre-wrap rounded bg-red-950/40 p-2 text-[11px] text-red-200">
                    {errorText}
                  </pre>
                )}
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
