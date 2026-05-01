"use client";

import * as React from "react";

type ChatContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

const ChatContext = React.createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const toggle = React.useCallback(() => setOpen((v) => !v), []);
  const value = React.useMemo(() => ({ open, setOpen, toggle }), [open, toggle]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatPanel(): ChatContextValue {
  const ctx = React.useContext(ChatContext);
  if (!ctx) throw new Error("useChatPanel must be used inside <ChatProvider>");
  return ctx;
}
