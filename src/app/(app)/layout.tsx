import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/topbar";
import { ChatProvider } from "@/components/chat/chat-context";
import { ChatPanel } from "@/components/chat/chat-panel";
import { MobileNavProvider } from "@/components/mobile-nav-context";
import { MobileSidebar } from "@/components/mobile-sidebar";
import { getSidebarData } from "@/components/sidebar-data";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { org, spaces } = await getSidebarData();
  return (
    <ChatProvider>
      <MobileNavProvider>
        <div className="flex h-svh w-full">
          <Sidebar org={org} spaces={spaces} className="hidden md:flex" />
          <MobileSidebar org={org} spaces={spaces} />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </div>
        <ChatPanel />
      </MobileNavProvider>
    </ChatProvider>
  );
}
