import { useState } from "react";
import Navbar from "@/components/navbar";
import Sidebar from "@/components/sidebar";
import { ConversationsProvider } from "@/context/ConversationsContext";
import { cn } from "@/lib/utils";

const KEY = "mayelai.sidebarCollapsed";
const readCollapsed = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

const DashboardLayout = ({ children }) => {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? "0" : "1");
      } catch {
        /* storage blocked: remember for this visit only */
      }
      return !c;
    });

  return (
    <ConversationsProvider>
      <div className="relative h-full app-surface">
        {/* Desktop sidebar: full menu or icon rail */}
        <aside
          className={cn(
            "fixed inset-y-0 z-[80] hidden border-r border-sidebar-border shadow-[1px_0_12px_-6px_rgb(0_0_0/0.08)] transition-[width] duration-200 md:flex md:flex-col",
            collapsed ? "w-[76px]" : "w-72"
          )}
        >
          <Sidebar collapsed={collapsed} onToggle={toggle} />
        </aside>

        {/* Full-height column: navbar on top, page fills the rest */}
        <main className={cn("flex h-dvh flex-col transition-[padding] duration-200", collapsed ? "md:pl-[76px]" : "md:pl-72")}>
          <Navbar />
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </main>
      </div>
    </ConversationsProvider>
  );
};

export default DashboardLayout;
