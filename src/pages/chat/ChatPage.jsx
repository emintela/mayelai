import { Search, Brain, Loader2, MessageSquare, Sparkles } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import Heading from "@/components/heading";
import ChatComposer from "@/components/chat-composer";
import { MessageActions, MessageAttachments } from "@/components/chat-messages";
import { cn } from "@/lib/utils";
import { splitPlan } from "@/lib/plan";
import { useChat } from "@/lib/useChat";

const Avatar = ({ role }) => (
  <div
    className={cn(
      "hidden h-9 w-9 sm:flex shrink-0 items-center justify-center rounded-full text-lg shadow-sm select-none",
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
  <div className="flex items-start gap-2 sm:gap-3 animate-in fade-in-0 slide-in-from-bottom-1">
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

const ChatPage = () => {
  const { conversationId } = useParams();
  const {
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
  } = useChat(conversationId, "/chat");
  const onSend = ({ text, attachments, mode }) => send(text, mode, attachments);

  const remaining = quota && quota.limit > 0 ? Math.max(quota.limit - quota.used, 0) : null;
  const isEmpty = messages.length === 0 && !pending && !loadingChat && !loadError;

  const composer = (
    <ChatComposer
      onSend={onSend}
      busy={!!pending}
      disabled={!!loadError}
      autoFocus={isEmpty}
      menuPlacement={isEmpty ? "down" : "up"}
      mode={mode}
      onModeChange={setMode}
    />
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
    <div className="flex h-full flex-col">
      <Heading
        title="AI Chat"
        description="Mayel'AI — Advanced AI Chat with Web Search"
        icon={MessageSquare}
        iconColor="text-violet-500"
        bgColor="bg-violet-500/10"
        className={isEmpty ? undefined : "hidden md:flex"}
      />

      {isEmpty ? (
        // New chat: greeting and message box centered on the page.
        <div className="flex flex-1 flex-col items-center justify-center px-3 pb-[max(10vh,env(safe-area-inset-bottom))] sm:px-4">
          <div className="text-4xl sm:text-5xl">👋</div>
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
            className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-3 py-4 sm:gap-6 sm:px-4 sm:py-6"
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
                  "flex items-start gap-2 animate-in fade-in-0 slide-in-from-bottom-1 sm:gap-3",
                  message.role === "user" && "flex-row-reverse"
                )}
              >
                <Avatar role={message.role} />
                <div className="flex max-w-[88%] min-w-0 flex-col sm:max-w-[75%]">
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
                    <MessageAttachments message={message} />
                    {message.content && (
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{splitPlan(message.content).text}</p>
                    )}
                    {splitPlan(message.content).plan && conversationId && (
                      <Link
                        to={`/onsave/ask/${conversationId}`}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                      >
                        <Sparkles className="h-4 w-4" /> Create these budgets in onSave
                      </Link>
                    )}
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
                    <MessageActions message={{ ...message, content: splitPlan(message.content).text }} onFeedback={handleFeedback} />
                  )}
                </div>
              </div>
            ))}

            {pending && <ThinkingIndicator mode={pending} />}
          </div>

          <div className="w-full shrink-0 border-t border-border bg-background/80 backdrop-blur-md">
            <div className="mx-auto w-full max-w-6xl px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:p-4">
              {composer}
              {quotaNote}

              {showSearchButton && (
                <div className="mt-2 flex gap-2 animate-in fade-in-0 slide-in-from-bottom-1">
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
