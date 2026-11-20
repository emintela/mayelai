import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiErrorMessage, useApi } from "@/lib/api";
import { useConversations } from "@/context/ConversationsContext";

// Chat state shared by the Mayel'AI chat page and Mayele in onSave.
// basePath is where a conversation lives ("/chat" → "/chat/:id").
export function useChat(conversationId, basePath = "/chat") {
  const navigate = useNavigate();
  const api = useApi();
  const { upsert } = useConversations();

  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(null); // null | "chat" | "search"
  const [loadingChat, setLoadingChat] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchButton, setShowSearchButton] = useState(false);
  const [quota, setQuota] = useState(null);
  const [mode, setMode] = useState("chat"); // "chat" (Instant) | "search"
  const chatContainerRef = useRef(null);
  // The conversation currently on screen, so a late reply isn't shown in another chat.
  const activeIdRef = useRef(conversationId ?? null);
  // Set right after a new chat is created, so we don't refetch what we already have.
  const justCreatedRef = useRef(null);

  // Load the conversation in the URL (or start empty for /chat).
  useEffect(() => {
    activeIdRef.current = conversationId ?? null;
    if (conversationId && justCreatedRef.current === conversationId) {
      justCreatedRef.current = null;
      return;
    }
    setShowSearchButton(false);
    setLoadError(null);
    setMessages([]);
    if (!conversationId) return;

    let cancelled = false;
    setLoadingChat(true);
    api
      .getConversation(conversationId)
      .then((data) => !cancelled && setMessages(data.messages))
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          err?.response?.status === 404
            ? "This chat doesn't exist or was deleted."
            : "Couldn't load this chat. Please try again."
        );
      })
      .finally(() => !cancelled && setLoadingChat(false));
    return () => {
      cancelled = true;
    };
  }, [conversationId, api]);

  useEffect(() => {
    api.getUsage().then(setQuota).catch(() => {});
  }, [api]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, pending]);

  const send = async (text, mode = "chat", attachments = []) => {
    const sentFrom = conversationId ?? null;
    const tempId = `temp-${Date.now()}`;
    // Shown immediately; image previews are kept after the server's copy replaces it.
    const local = attachments.map(({ name, kind, size, previewUrl }) => ({ name, kind, size, previewUrl }));
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        role: "user",
        content: text,
        metadata: mode !== "chat" ? { mode } : undefined,
        localAttachments: local.length ? local : undefined,
      },
    ]);
    setShowSearchButton(false);
    setPending(mode);
    try {
      const data = await api.sendMessage({
        conversationId: sentFrom ?? undefined,
        message: text,
        mode,
        attachments: attachments.length
          ? attachments.map(({ name, type, data }) => ({ name, type, data }))
          : undefined,
      });
      upsert(data.conversation);
      setQuota(data.quota);
      if (activeIdRef.current !== sentFrom) return; // user switched chats meanwhile
      setMessages((prev) => [
        ...prev.map((m) =>
          m.id === tempId ? { ...data.userMessage, localAttachments: m.localAttachments } : m
        ),
        data.assistantMessage,
      ]);
      setSearchQuery(text);
      setShowSearchButton(data.searchSuggestion);
      if (!sentFrom) {
        justCreatedRef.current = data.conversation.id;
        activeIdRef.current = data.conversation.id;
        navigate(`${basePath}/${data.conversation.id}`, { replace: true });
      }
    } catch (error) {
      console.error("❌ AI Chat Error:", error);
      if (activeIdRef.current !== sentFrom) return;
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: apiErrorMessage(error),
          error: true,
          upgrade: !!error?.response?.data?.upgrade,
        },
      ]);
    } finally {
      setPending(null);
    }
  };

  // Like / dislike: update immediately, roll back if saving fails.
  const handleFeedback = async (message, value) => {
    const setValue = (v) =>
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, feedback: v } : m)));
    const previous = message.feedback ?? 0;
    setValue(value);
    try {
      await api.setFeedback(message.id, value);
    } catch {
      setValue(previous);
    }
  };

  return {
    messages,
    pending,
    loadingChat,
    loadError,
    searchQuery,
    showSearchButton,
    quota,
    mode,
    setMode,
    chatContainerRef,
    send,
    handleFeedback,
  };
}
