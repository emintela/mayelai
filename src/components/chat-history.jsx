import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Loader2, MessageSquare, MoreHorizontal, MoreVertical, Search, Trash2, X } from "lucide-react";
import { useConversations } from "@/context/ConversationsContext";
import { cn } from "@/lib/utils";

// "2h ago", "1d ago", "Mar 4".
function ago(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Small dropdown that closes on outside click or Escape.
function Menu({ label, icon: Icon, children, className }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (e.type === "keydown" ? e.key === "Escape" : !ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-card hover:text-foreground",
          open && "bg-card text-foreground"
        )}
      >
        <Icon className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className="absolute right-0 top-full z-50 mt-1 min-w-40 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95"
        >
          {children}
        </div>
      )}
    </div>
  );
}

const menuItem = "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-destructive-foreground transition hover:bg-destructive/10";

// Sidebar section listing the user's past chats, with search and delete.
const ChatHistory = () => {
  const { conversations, query, setQuery, loading, error, remove, removeAll } = useConversations();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const handleDelete = async (conv) => {
    if (!window.confirm(`Delete "${conv.title}"? This can't be undone.`)) return;
    try {
      await remove(conv.id);
      if (pathname === `/chat/${conv.id}`) navigate("/chat");
    } catch {
      window.alert("Couldn't delete this chat. Please try again.");
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm("Delete ALL of your chat history? This can't be undone.")) return;
    try {
      await removeAll();
      if (pathname.startsWith("/chat/")) navigate("/chat");
    } catch {
      window.alert("Couldn't clear your history. Please try again.");
    }
  };

  const searching = query.trim() !== "";

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pt-4">
      <div className="flex items-center justify-between pb-2 pl-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Chat history</span>
        {conversations.length > 0 && !searching && (
          <Menu label="Chat history options" icon={MoreHorizontal}>
            <button type="button" role="menuitem" onClick={handleClearAll} className={menuItem}>
              <Trash2 className="h-4 w-4" /> Clear all history
            </button>
          </Menu>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats…"
          aria-label="Search chats"
          className="h-10 w-full rounded-xl border border-sidebar-border bg-card pl-9 pr-8 text-base text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring/60 focus:ring-2 focus:ring-ring/20 md:text-sm"
        />
        {searching && (
          <button
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="-mx-1 mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1 pb-2">
        {loading && conversations.length === 0 && (
          <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {error && <p className="px-3 py-2 text-sm text-destructive-foreground">{error}</p>}
        {!loading && !error && conversations.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            {searching ? `No chats match “${query.trim()}”.` : "No chats yet. Start one!"}
          </p>
        )}

        {conversations.map((conv) => {
          const active = pathname === `/chat/${conv.id}`;
          return (
            <div
              key={conv.id}
              className={cn("group flex items-center rounded-xl transition hover:bg-sidebar-accent/60", active && "bg-sidebar-accent")}
            >
              <Link to={`/chat/${conv.id}`} className="flex min-w-0 flex-1 items-start gap-2.5 py-2 pl-2.5 pr-1">
                <MessageSquare className={cn("mt-0.5 h-4 w-4 shrink-0", active ? "text-sidebar-accent-foreground" : "text-primary/70")} />
                <span className="min-w-0">
                  <span className={cn("block truncate text-sm", active ? "font-semibold text-sidebar-accent-foreground" : "font-medium text-sidebar-foreground")}>
                    {conv.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{conv.snippet || ago(conv.updatedAt)}</span>
                </span>
              </Link>
              <Menu label={`Options for "${conv.title}"`} icon={MoreVertical} className="mr-1 md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100">
                <button type="button" role="menuitem" onClick={() => handleDelete(conv)} className={menuItem}>
                  <Trash2 className="h-4 w-4" /> Delete chat
                </button>
              </Menu>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ChatHistory;
