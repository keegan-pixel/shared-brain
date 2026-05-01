"use client";

import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatPanel } from "./chat-context";

export function ChatToggleButton() {
  const { open, toggle } = useChatPanel();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={open ? "Close Claude chat" : "Open Claude chat"}
      onClick={toggle}
    >
      <MessageSquare className="h-4 w-4" />
    </Button>
  );
}
