import { Link, useLocation } from "react-router-dom";
import { Plus, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import ChatHistory from "@/components/chat-history";

// Layout: logo + "New chat" pinned at the top, "Settings" pinned at the
// bottom, and the chat history scrolling in between.
const Sidebar = () => {
  const { pathname } = useLocation();

  return (
    <div className="flex h-full flex-col bg-[#662d91] text-white">
      {/* Top (fixed) */}
      <div className="shrink-0 space-y-5 px-3 pb-2 pt-5">
        <Link to="/chat" className="flex items-center gap-3 pl-3">
          <div className="relative h-9 w-9 overflow-hidden rounded-lg ring-1 ring-white/20">
            <img alt="logo" src="/logo1.png" className="absolute inset-0 h-full w-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "Montserrat, sans-serif" }}>
            Mayel'AI
          </h1>
        </Link>
        <Link
          to="/chat"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/15 px-3 py-2.5 text-sm font-medium text-white ring-1 ring-white/20 transition hover:bg-white/25"
        >
          <Plus className="h-4 w-4" />
          New chat
        </Link>
      </div>

      {/* Divider */}
      <div className="mx-6 my-3 shrink-0 border-t border-white/15" />

      {/* Middle (scrolls) */}
      <ChatHistory />

      {/* Bottom (fixed) */}
      <div className="shrink-0 border-t border-white/10 px-3 py-3">
        <Link
          to="/settings"
          className={cn(
            "flex w-full items-center rounded-lg border-l-2 border-transparent p-3 text-sm font-medium transition hover:bg-white/10 hover:text-white",
            pathname === "/settings" ? "border-amber-400 bg-white/15 text-white" : "text-white/60"
          )}
        >
          <Settings className="mr-3 h-5 w-5" />
          Settings
        </Link>
      </div>
    </div>
  );
};

export default Sidebar;
