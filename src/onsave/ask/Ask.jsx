import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Brain, History, Loader2, MessageSquare, Search, SquarePen, Sparkles, Trash2, Wallet, X } from "lucide-react";
import ChatComposer from "@/components/chat-composer";
import { MessageActions, MessageAttachments } from "@/components/chat-messages";
import { ConversationsProvider, useConversations } from "@/context/ConversationsContext";
import { useT } from "@/lib/i18n";
import { useChat } from "@/lib/useChat";
import { cn } from "@/lib/utils";
import { LogoMark, iconBtn } from "../ui";

// Mayele: the Mayel'AI assistant inside onSave. Same conversations as the web chat.

const SUGGESTIONS = ["osaIdea1", "osaIdea2", "osaIdea3", "osaIdea4"];
const FIN_SUGGESTIONS = ["chatFinIdea1", "chatFinIdea2", "chatFinIdea3", "chatFinIdea4"];
const FIN_KEY = "mayelai.chatFinance";

// "General" or "My Finances": remembered on this device; ?fin=1 opens My Finances.
function useFinanceMode() {
  const [params] = useSearchParams();
  const [on, setOn] = useState(() => {
    if (params.get("fin") === "1") return true;
    try {
      return localStorage.getItem(FIN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const set = (v) => {
    setOn(v);
    try {
      localStorage.setItem(FIN_KEY, v ? "1" : "0");
    } catch {
      /* private mode */
    }
  };
  return [on, set];
}

function FinanceSwitch({ on, setOn }) {
  const t = useT();
  return (
    <div role="tablist" className="mx-auto grid w-full max-w-lg grid-cols-2 gap-1 rounded-full bg-os-line-soft p-1">
      {[
        [false, t("chatGeneral")],
        [true, t("chatMyFin")],
      ].map(([v, label]) => (
        <button
          key={label}
          type="button"
          role="tab"
          aria-selected={on === v}
          onClick={() => setOn(v)}
          className={cn("h-9 rounded-full text-[13px] font-semibold transition", on === v ? "bg-os-btn text-white shadow-sm" : "text-os-muted")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Thinking({ mode }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 self-start rounded-3xl rounded-bl-md border border-os-line bg-os-card px-4 py-3">
      <span className="text-sm text-os-muted">{t(mode === "search" ? "osaSearching" : "osaThinking")}</span>
      <span className="flex gap-1">
        {["-0.3s", "-0.15s", "0s"].map((d) => (
          <span key={d} style={{ animationDelay: d }} className="h-1.5 w-1.5 animate-bounce rounded-full bg-os-muted/60" />
        ))}
      </span>
    </div>
  );
}

// Past chats, in a sheet over the conversation.
function HistorySheet({ onClose }) {
  const t = useT();
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const { conversations, query, setQuery, loading, remove } = useConversations();
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const del = async (c) => {
    if (!window.confirm(`${t("osaDelete")} — ${c.title}?`)) return;
    try {
      await remove(c.id);
      if (String(c.id) === conversationId) navigate("/onsave/ask", { replace: true });
    } catch {
      /* stays in the list */
    }
  };
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t("osaHistory")}
        onClick={(e) => e.stopPropagation()}
        className="onsave mx-auto flex max-h-[80dvh] w-full max-w-lg flex-col rounded-t-[28px] bg-os-bg px-5 pt-3"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }}
      >
        <span className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-os-line" />
        <div className="flex items-center justify-between pb-3">
          <h2 className="os-display text-xl font-extrabold">{t("osaHistory")}</h2>
          <button type="button" onClick={onClose} aria-label={t("osClose")} className={iconBtn}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-os-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("osaSearchChats")}
            aria-label={t("osaSearchChats")}
            className="h-11 w-full rounded-2xl border border-os-line bg-os-card pl-10 pr-4 text-base outline-none focus:border-os-brand"
          />
        </div>
        <ul className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto pb-2">
          {loading && !conversations.length && (
            <li className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-os-muted" />
            </li>
          )}
          {!loading && !conversations.length && <li className="py-6 text-center text-sm text-os-muted">{t("osaNoChats")}</li>}
          {conversations.map((c) => (
            <li key={c.id} className={cn("flex items-center rounded-2xl", String(c.id) === conversationId && "bg-os-brand-soft")}>
              <Link to={`/onsave/ask/${c.id}`} onClick={onClose} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5">
                <MessageSquare className="h-4 w-4 shrink-0 text-os-brand" />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium">{c.title}</span>
                  {c.snippet && <span className="block truncate text-xs text-os-muted">{c.snippet}</span>}
                </span>
              </Link>
              <button type="button" onClick={() => del(c)} aria-label={`${t("osaDelete")} ${c.title}`} className="mr-1 rounded-full p-2 text-os-muted hover:text-os-danger">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function AskScreen() {
  const t = useT();
  const { conversationId } = useParams();
  const [history, setHistory] = useState(false);
  const [finance, setFinance] = useFinanceMode();
  const { messages, pending, loadingChat, loadError, searchQuery, showSearchButton, quota, mode, setMode, chatContainerRef, send: rawSend, handleFeedback } =
    useChat(conversationId, "/onsave/ask");
  // In My Finances, a normal message goes with the person's money data.
  const send = (text, m = "chat", attachments) => rawSend(text, finance && m === "chat" ? "finance" : m, attachments);
  const ideas = finance ? FIN_SUGGESTIONS : SUGGESTIONS;
  const isEmpty = messages.length === 0 && !pending && !loadingChat && !loadError;
  const remaining = quota && quota.limit > 0 ? Math.max(quota.limit - quota.used, 0) : null;

  const composer = (
    <ChatComposer
      onSend={({ text, attachments, mode }) => send(text, mode, attachments)}
      busy={!!pending}
      disabled={!!loadError}
      autoFocus={false}
      menuPlacement="up"
      mode={mode}
      onModeChange={setMode}
      placeholder={t(finance ? "chatFinPlaceholder" : "osaPlaceholder")}
    />
  );

  return (
    // Full screen: header, scrolling messages, message box at the bottom.
    <div className="fixed inset-0 z-10 flex flex-col bg-os-bg">
      <header
        className="mx-auto flex w-full max-w-lg shrink-0 items-center gap-3 border-b border-os-line px-4 pb-3"
        style={{ paddingTop: "max(env(safe-area-inset-top), 14px)" }}
      >
        <Link to="/onsave" aria-label={t("back")} className={iconBtn}>
          <X className="h-5 w-5" />
        </Link>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-os-deep">
            <LogoMark size={20} />
          </span>
          <span className="leading-tight">
            <span className="os-display block text-base font-extrabold">Mayele</span>
            <span className="block text-[11px] text-os-muted">{t("osaSubtitle")}</span>
          </span>
        </div>
        <button type="button" onClick={() => setHistory(true)} aria-label={t("osaHistory")} className={iconBtn}>
          <History className="h-5 w-5" />
        </button>
        <Link to="/onsave/ask" aria-label={t("osaNewChat")} className={iconBtn}>
          <SquarePen className="h-5 w-5" />
        </Link>
      </header>
      <div className="shrink-0 px-4 pt-3">
        <FinanceSwitch on={finance} setOn={setFinance} />
      </div>

      <div ref={chatContainerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-4 px-4 py-5">
          {isEmpty && (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-os-deep shadow-[0_12px_30px_rgba(36,26,79,0.25)]">
                <LogoMark size={40} />
              </span>
              <h1 className="os-display mt-4 text-[26px] font-extrabold">{t(finance ? "chatFinHello" : "osaHello")}</h1>
              <p className="mt-1 max-w-xs text-[14px] text-os-muted">{t(finance ? "chatFinIntro" : "osaIntro")}</p>
              <div className="mt-6 grid w-full gap-2">
                {ideas.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => send(t(k), "chat")}
                    className="flex items-center gap-3 rounded-2xl border border-os-line bg-os-card px-4 py-3 text-left text-[14px] font-medium transition hover:border-os-brand/40"
                  >
                    {finance ? <Wallet className="h-4 w-4 shrink-0 text-os-brand" /> : <Sparkles className="h-4 w-4 shrink-0 text-os-brand" />} {t(k)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {loadingChat && (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-os-muted" />
            </div>
          )}
          {loadError && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-os-muted">{loadError}</p>
              <Link to="/onsave/ask" className="text-sm font-semibold text-os-brand">
                {t("osaNewChat")}
              </Link>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={cn("flex max-w-[88%] flex-col", m.role === "user" ? "self-end items-end" : "self-start")}>
              <div
                className={cn(
                  "rounded-3xl px-4 py-3",
                  m.role === "user" ? "rounded-br-md bg-os-btn text-white" : "rounded-bl-md border border-os-line bg-os-card text-os-ink"
                )}
              >
                {m.metadata?.mode === "finance" && (
                  <span className="mb-1 inline-flex items-center gap-1 text-xs opacity-80">
                    <Wallet className="h-3 w-3" /> {t("chatFinBadge")}
                  </span>
                )}
                {m.metadata?.mode === "search" && (
                  <span className="mb-1 inline-flex items-center gap-1 text-xs opacity-80">
                    <Brain className="h-3 w-3" /> {t("osaAiSearch")}
                  </span>
                )}
                <MessageAttachments message={m} />
                {m.content && <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{m.content}</p>}
                {m.upgrade && (
                  <Link to="/settings" className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-os-btn px-4 py-1.5 text-sm font-semibold text-white">
                    <Sparkles className="h-4 w-4" /> {t("upgrade")}
                  </Link>
                )}
              </div>
              {m.role === "assistant" && !m.error && typeof m.id === "number" && <MessageActions message={m} onFeedback={handleFeedback} />}
            </div>
          ))}
          {pending && <Thinking mode={pending} />}
        </div>
      </div>

      <div className="shrink-0 border-t border-os-line bg-os-bg/95 backdrop-blur-md">
        <div className="mx-auto w-full max-w-lg px-3 pt-2" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 10px)" }}>
          {showSearchButton && (
            <button
              type="button"
              onClick={() => send(searchQuery, "search")}
              disabled={!!pending}
              className="mb-2 flex w-full items-center justify-center gap-2 rounded-full bg-os-brand-soft py-2 text-sm font-semibold text-os-brand-ink"
            >
              <Brain className="h-4 w-4" /> {t("osaSearchWeb")}
            </button>
          )}
          {composer}
          {remaining !== null && remaining <= 10 && (
            <p className="mt-1.5 text-center text-xs text-os-muted">
              {remaining === 0 ? t("osaNoneLeft") : t("osaLeft", { n: remaining })}
              {quota.plan === "free" && (
                <>
                  {" · "}
                  <Link to="/settings" className="font-semibold text-os-brand">
                    {t("upgrade")}
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
      </div>

      {history && <HistorySheet onClose={() => setHistory(false)} />}
    </div>
  );
}

export default function Ask() {
  return (
    <ConversationsProvider>
      <AskScreen />
    </ConversationsProvider>
  );
}
