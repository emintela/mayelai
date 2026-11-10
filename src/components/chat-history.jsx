import { Link, useLocation, useNavigate } from "react-router-dom";
import { Loader2, Search, Trash2, X } from "lucide-react";
import { useConversations } from "@/context/ConversationsContext";
import { cn } from "@/lib/utils";

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
    <div className="flex min-h-0 flex-1 flex-col px-3">
      <span className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Chat history
      </span>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats…"
          aria-label="Search chats"
          className="w-full rounded-lg border border-sidebar-border bg-card py-2 pl-8 pr-8 text-base text-foreground md:text-sm outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
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

      <div className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-2">
        {loading && conversations.length === 0 && (
          <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {error && <p className="px-3 py-2 text-sm text-destructive">{error}</p>}
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
              className={cn(
                "group flex items-center rounded-lg transition hover:bg-sidebar-accent/60",
                active && "bg-sidebar-accent"
              )}
            >
              <Link to={`/chat/${conv.id}`} className="min-w-0 flex-1 px-3 py-2">
                <p className={cn("truncate text-sm", active ? "font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground")}>
                  {conv.title}
                </p>
                {conv.snippet && (
                  <p className="truncate text-xs text-muted-foreground">{conv.snippet}</p>
                )}
              </Link>
              <button
                onClick={() => handleDelete(conv)}
                aria-label={`Delete chat "${conv.title}"`}
                title="Delete chat"
                className="mr-1 rounded p-1.5 text-muted-foreground transition hover:bg-card hover:text-destructive focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      {!searching && conversations.length > 0 && (
        <button
          onClick={handleClearAll}
          className="mb-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs text-muted-foreground transition hover:bg-sidebar-accent/60 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" /> Clear all history
        </button>
      )}
    </div>
  );
};

export default ChatHistory;
