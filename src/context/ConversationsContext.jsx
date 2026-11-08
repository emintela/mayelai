import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/api";

const ConversationsContext = createContext(null);

// Shares the user's chat history (and the sidebar search) between the
// desktop sidebar, the mobile sidebar and the chat page.
export function ConversationsProvider({ children }) {
  const api = useApi();
  const [conversations, setConversations] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestId = useRef(0);

  const load = useCallback(
    async (q) => {
      const id = ++requestId.current;
      setLoading(true);
      try {
        const data = await api.listConversations(q);
        if (id === requestId.current) {
          setConversations(data.conversations);
          setError(null);
        }
      } catch {
        if (id === requestId.current) setError("Couldn't load your chats.");
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [api]
  );

  // Debounce searches so we don't query on every keystroke.
  useEffect(() => {
    const q = query.trim();
    const t = setTimeout(() => load(q), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [query, load]);

  // Put a new or updated conversation at the top of the list.
  const upsert = useCallback(
    (conv) => {
      if (query.trim()) return; // showing search results; leave them alone
      setConversations((prev) => [conv, ...prev.filter((c) => c.id !== conv.id)]);
    },
    [query]
  );

  const remove = useCallback(
    async (id) => {
      await api.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
    },
    [api]
  );

  const removeAll = useCallback(async () => {
    await api.deleteAllConversations();
    setConversations([]);
  }, [api]);

  return (
    <ConversationsContext.Provider
      value={{ conversations, query, setQuery, loading, error, upsert, remove, removeAll }}
    >
      {children}
    </ConversationsContext.Provider>
  );
}

export function useConversations() {
  const ctx = useContext(ConversationsContext);
  if (!ctx) throw new Error("useConversations must be used inside ConversationsProvider");
  return ctx;
}
