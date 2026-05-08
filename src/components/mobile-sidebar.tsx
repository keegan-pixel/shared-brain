"use client";

import { Sheet } from "@/components/ui/sheet";
import { Sidebar } from "@/components/sidebar";
import { useMobileNav } from "@/components/mobile-nav-context";
import type { SidebarOrg, SidebarSpace } from "@/components/sidebar-data";

type MobileSidebarProps = {
  org: SidebarOrg;
  spaces: SidebarSpace[];
};

export function MobileSidebar({ org, spaces }: MobileSidebarProps) {
  const { open, setOpen } = useMobileNav();
  return (
    <Sheet open={open} onClose={() => setOpen(false)} side="left" className="max-w-[16rem]">
      <Sidebar
        org={org}
        spaces={spaces}
        className="h-full w-full border-r-0"
        onNavigate={() => setOpen(false)}
      />
    </Sheet>
  );
}
