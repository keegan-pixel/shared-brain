"use client";

import { Menu, Search } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { ActivityBell } from "@/components/activity-bell";
import { ChatToggleButton } from "@/components/chat/chat-toggle-button";
import { useMobileNav } from "@/components/mobile-nav-context";

export function TopBar() {
  const { setOpen } = useMobileNav();
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </Button>
      <div className="relative flex-1 max-w-xl">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
        <Input placeholder="Search projects, items, wiki..." className="pl-8" disabled />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <ActivityBell />
        <ChatToggleButton />
        <ThemeToggle />
        <div className="ml-2">
          <UserButton />
        </div>
      </div>
    </header>
  );
}
