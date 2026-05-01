import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/topbar";
import { ChatProvider } from "@/components/chat/chat-context";
import { ChatPanel } from "@/components/chat/chat-panel";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ChatProvider>
      <div className="flex h-svh w-full">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
      <ChatPanel />
    </ChatProvider>
  );
}
