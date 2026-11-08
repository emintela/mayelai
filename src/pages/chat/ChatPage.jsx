import { useState, useEffect, useRef } from "react";
import {
  Search,
  Brain,
  Check,
  Copy,
  ThumbsUp,
  ThumbsDown,
  Share2,
  Send,
  Loader2,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import Heading from "@/components/heading";
import { useForm } from "react-hook-form";
import { formSchema } from "./constants";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { apiErrorMessage, useApi } from "@/lib/api";
import { useConversations } from "@/context/ConversationsContext";

const Avatar = ({ role }) => (
  <div
    className={cn(
      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg shadow-sm select-none",
      role === "user"
        ? "bg-primary text-primary-foreground"
        : "bg-gradient-to-br from-primary to-fuchsia-500 text-white"
    )}
  >
    {role === "user" ? "🧑" : "🤖"}
  </div>
);

// Shown while waiting for the reply.
const ThinkingIndicator = ({ mode }) => (
  <div className="flex items-start gap-3 animate-in fade-in-0 slide-in-from-bottom-1">
    <Avatar role="assistant" />
    <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-border bg-muted px-4 py-3 shadow-sm">
      <span className="text-sm text-muted-foreground">
        {mode === "search" ? "Searching the web" : "Thinking"}
      </span>
      <span className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
      </span>
    </div>
  </div>
);

const ActionButton = ({ label, onClick, active, activeClass, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    aria-pressed={active}
    className={cn(
      "rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground",
      active && activeClass
    )}
  >
    {children}
  </button>
);

// Copy / share / like / dislike under an assistant reply.
const MessageActions = ({ message, onFeedback }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Mayel'AI", text: message.content });
      } catch {
        /* user cancelled */
      }
    } else {
      copy();
    }
  };

  return (
    <div className="mt-1 flex items-center gap-0.5 pl-1">
      <ActionButton label={copied ? "Copied" : "Copy"} onClick={copy}>
        {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
      </ActionButton>
      <ActionButton label="Share" onClick={share}>
        <Share2 className="h-4 w-4" />
      </ActionButton>
      <ActionButton
        label="Good response"
        active={message.feedback === 1}
        activeClass="text-emerald-500 hover:text-emerald-500"
        onClick={() => onFeedback(message, message.feedback === 1 ? 0 : 1)}
      >
        <ThumbsUp className="h-4 w-4" fill={message.feedback === 1 ? "currentColor" : "none"} />
      </ActionButton>
      <ActionButton
        label="Bad response"
        active={message.feedback === -1}
        activeClass="text-rose-500 hover:text-rose-500"
        onClick={() => onFeedback(message, message.feedback === -1 ? 0 : -1)}
      >
        <ThumbsDown className="h-4 w-4" fill={message.feedback === -1 ? "currentColor" : "none"} />
      </ActionButton>
    </div>
  );
};

const ChatPage = () => {
  const { conversationId } = useParams();
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
  const chatContainerRef = useRef(null);
  // The conversation currently on screen, so a late reply isn't shown in another chat.
  const activeIdRef = useRef(conversationId ?? null);
  // Set right after a new chat is created, so we don't refetch what we already have.
  const justCreatedRef = useRef(null);

  const { register, handleSubmit, reset } = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { prompt: "" },
  });

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

  const send = async (text, mode = "chat") => {
    const sentFrom = conversationId ?? null;
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, role: "user", content: text, metadata: mode === "search" ? { mode } : undefined },
    ]);
    setShowSearchButton(false);
    setPending(mode);
    try {
      const data = await api.sendMessage({ conversationId: sentFrom ?? undefined, message: text, mode });
      upsert(data.conversation);
      setQuota(data.quota);
      if (activeIdRef.current !== sentFrom) return; // user switched chats meanwhile
      setMessages((prev) => [
        ...prev.map((m) => (m.id === tempId ? data.userMessage : m)),
        data.assistantMessage,
      ]);
      setSearchQuery(text);
      setShowSearchButton(data.searchSuggestion);
      if (!sentFrom) {
        justCreatedRef.current = data.conversation.id;
        activeIdRef.current = data.conversation.id;
        navigate(`/chat/${data.conversation.id}`, { replace: true });
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

  const onSubmit = async (values) => {
    reset();
    await send(values.prompt);
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

  const remaining = quota && quota.limit > 0 ? Math.max(quota.limit - quota.used, 0) : null;
  const isEmpty = messages.length === 0 && !pending && !loadingChat && !loadError;

  const composer = (
    <form onSubmit={handleSubmit(onSubmit)} className="relative flex items-center">
      <input
        {...register("prompt")}
        placeholder="Message Mayel'AI..."
        autoComplete="off"
        autoFocus={isEmpty}
        className="w-full rounded-full border border-input bg-card py-3 pl-5 pr-14 text-sm shadow-sm outline-none transition focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
        disabled={!!pending || !!loadError}
      />
      <button
        type="submit"
        disabled={!!pending || !!loadError}
        aria-label="Send message"
        className="absolute right-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </button>
    </form>
  );

  const quotaNote = remaining !== null && remaining <= 10 && (
    <p className="mt-2 text-center text-xs text-muted-foreground">
      {remaining === 0
        ? "You've used all of today's messages. They reset at midnight UTC."
        : `${remaining} message${remaining === 1 ? "" : "s"} left today`}
      {quota.plan === "free" && (
        <>
          {" · "}
          <Link to="/settings" className="font-medium text-primary hover:underline">
            Upgrade to Pro
          </Link>
        </>
      )}
    </p>
  );

  return (
    <div className="flex h-full flex-col bg-background">
      <Heading
        title="💬 AI Chat"
        description="Mayel'AI — Advanced AI Chat with Web Search"
        icon={MessageSquare}
        iconColor="text-violet-500"
        bgColor="bg-violet-500/10"
      />

      {isEmpty ? (
        // New chat: greeting and message box centered on the page.
        <div className="flex flex-1 flex-col items-center justify-center px-4 pb-[10vh]">
          <div className="text-5xl">👋</div>
          <h3 className="mt-3 text-xl font-semibold">Hey, I'm Mayel'AI</h3>
          <p className="mt-2 max-w-sm text-center text-sm text-muted-foreground">
            Ask me anything — quick questions or deep dives. I'll offer to search the web if I'm
            not sure. 🔎
          </p>
          <div className="mt-8 w-full max-w-2xl">
            {composer}
            {quotaNote}
          </div>
        </div>
      ) : (
        <>
          <div
            ref={chatContainerRef}
            className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-6 overflow-y-auto px-4 py-6"
          >
            {loadingChat && (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading chat…
              </div>
            )}

            {loadError && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-center">
                <p className="text-sm text-muted-foreground">{loadError}</p>
                <Link to="/chat" className="text-sm font-medium text-primary hover:underline">
                  Start a new chat
                </Link>
              </div>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex items-start gap-3 animate-in fade-in-0 slide-in-from-bottom-1",
                  message.role === "user" && "flex-row-reverse"
                )}
              >
                <Avatar role={message.role} />
                <div className="flex max-w-[75%] flex-col">
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-3 shadow-sm",
                      message.role === "user"
                        ? "rounded-br-sm bg-primary text-primary-foreground"
                        : "rounded-bl-sm border border-border bg-muted text-foreground"
                    )}
                  >
                    {message.metadata?.mode === "search" && (
                      <span className="mb-1 inline-flex items-center gap-1 text-xs opacity-80">
                        <Brain className="h-3 w-3" /> AI Search
                      </span>
                    )}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                    {message.upgrade && (
                      <Link
                        to="/settings"
                        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                      >
                        <Sparkles className="h-4 w-4" /> Upgrade to Pro
                      </Link>
                    )}
                  </div>
                  {message.role === "assistant" && !message.error && typeof message.id === "number" && (
                    <MessageActions message={message} onFeedback={handleFeedback} />
                  )}
                </div>
              </div>
            ))}

            {pending && <ThinkingIndicator mode={pending} />}
          </div>

          <div className="w-full shrink-0 border-t border-border bg-background/80 backdrop-blur-md">
            <div className="mx-auto w-full max-w-6xl p-4">
              {composer}
              {quotaNote}

              {showSearchButton && (
                <div className="mt-3 flex gap-2 animate-in fade-in-0 slide-in-from-bottom-1">
                  <Link
                    to={`/websearch?searchQuery=${encodeURIComponent(searchQuery)}`}
                    className="flex-1"
                  >
                    <button className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-amber-600">
                      <Search className="h-4 w-4" />
                      Web Search 🌐
                    </button>
                  </Link>
                  <button
                    onClick={() => send(searchQuery, "search")}
                    disabled={!!pending}
                    className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition hover:opacity-90"
                  >
                    <Brain className="h-4 w-4" />
                    AI Search ✨
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ChatPage;
