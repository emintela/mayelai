import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { ArrowRight, BarChart3, Bell, CalendarDays, ChevronRight, MessageCircle, Sparkles, Users } from "lucide-react";
import { useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { lastSeenActivity } from "./Activity";
import { ConnectCard, HideButton, SpendCard, TipsCard, accountCount, hasBanks, shown, useBudgetTotal, useFin, useHidden, useTips } from "./fin/shared";
import { Avatar, LogoMark, card, dueItems, money, nextPayout } from "./ui";

// Home: the Mayel'AI dashboard. Chat, AI Fin, onSave and (soon) Budget.

function ChatCard() {
  const t = useT();
  return (
    <Link
      to="/onsave/ask?fin=1"
      className="relative block overflow-hidden rounded-[28px] bg-gradient-to-br from-[#5a3fd4] via-[#6d4fe0] to-[#9a7bf5] p-5 text-white shadow-[0_14px_30px_rgba(90,63,212,0.3)] transition active:scale-[0.99]"
    >
      <svg width="150" height="110" viewBox="0 0 150 110" aria-hidden="true" className="absolute -bottom-1 right-2 opacity-60">
        {[[10, 70], [40, 52], [70, 60], [100, 34], [130, 14]].map(([x, y]) => (
          <rect key={x} x={x} y={y} width="18" height={110 - y} rx="5" fill="white" fillOpacity="0.28" />
        ))}
        <path d="M8 66 L46 44 L76 52 L106 26 L142 6" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <p className="flex items-center gap-2 text-lg font-bold">
        <Sparkles className="h-5 w-5" aria-hidden="true" /> {t("homeChatTitle")}
      </p>
      <p className="mt-1 max-w-[16rem] text-[13px] leading-relaxed text-white/85">{t("homeChatBody")}</p>
      <span className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-[14px] font-bold text-[#3f2aa8]">
        {t("homeChatCta")} <ArrowRight className="h-4 w-4" />
      </span>
    </Link>
  );
}

function Tiles() {
  const t = useT();
  const tiles = [
    ["/onsave/ask", MessageCircle, t("homeAiChat")],
    ["/onsave/fin", BarChart3, t("homeAiFin")],
    ["/onsave/save", Users, t("homeOnSave")],
    ["/onsave/budget", CalendarDays, t("homeBudget")],
  ];
  return (
    <div className="grid grid-cols-4 gap-2.5">
      {tiles.map(([to, Icon, title]) => {
        const inner = (
          <>
            <Icon className="h-7 w-7 text-os-brand" strokeWidth={1.8} aria-hidden="true" />
            <span className="text-[12px] font-semibold">{title}</span>
            {!to && <span className="absolute right-1.5 top-1.5 rounded-full bg-os-line-soft px-1.5 text-[9px] font-bold uppercase text-os-muted">{t("homeSoon")}</span>}
          </>
        );
        const cls = cn(card, "relative flex aspect-square flex-col items-center justify-center gap-1.5 rounded-2xl text-center transition");
        return to ? (
          <Link key={title} to={to} className={cn(cls, "hover:border-os-brand/40 active:scale-[0.97]")}>
            {inner}
          </Link>
        ) : (
          <div key={title} aria-disabled="true" className={cn(cls, "opacity-60")}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

function NetWorth({ o, hidden, toggle }) {
  const t = useT();
  const lang = useLang();
  return (
    <section className={cn(card, "p-4")}>
      <div className="flex items-center justify-between">
        <p className="text-[14px] font-bold">
          {t("homeNetWorth")} <span className="text-xs font-normal text-os-muted">({accountCount(o)} {t("homeConnected")})</span>
        </p>
        <HideButton hidden={hidden} onToggle={toggle} />
      </div>
      <Link to="/onsave/fin" className="mt-0.5 flex items-center justify-between gap-2">
        <span className="os-display text-[30px] font-extrabold leading-tight">{shown(hidden, money(o.net_cents, o.currency, lang))}</span>
        <ChevronRight className="h-5 w-5 text-os-muted" aria-hidden="true" />
      </Link>
    </section>
  );
}

// A short line about the family savings groups.
function OnSaveCard() {
  const t = useT();
  const lang = useLang();
  const api = useApi();
  const [groups, setGroups] = useState(null);
  useEffect(() => {
    api.myGroups().then((d) => setGroups(d.groups)).catch(() => setGroups([]));
  }, [api]);
  if (!groups) return null;
  const due = dueItems(groups)[0];
  const next = nextPayout(groups);
  const line = due
    ? t("homeDue", { amount: money(due.g.amount_cents, due.g.currency, lang), group: due.g.name })
    : next
      ? t("homeNextPayout", { amount: money(next.g.pot_cents, next.g.currency, lang), group: next.g.name })
      : t("homeNoGroups");
  return (
    <Link to="/onsave/save" className={cn(card, "flex items-center gap-3 p-4 transition hover:border-os-brand/40")}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-os-deep">
        <LogoMark size={26} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold">{t("homeOnSaveTitle")}</span>
        <span className={cn("block truncate text-[13px]", due ? "font-semibold text-os-warn" : "text-os-muted")}>{line}</span>
      </span>
      <ChevronRight className="h-5 w-5 text-os-muted" aria-hidden="true" />
    </Link>
  );
}

export default function Dashboard() {
  const t = useT();
  const api = useApi();
  const { user } = useUser();
  const fin = useFin();
  const [hidden, toggle] = useHidden();
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    api
      .activity()
      .then((d) => d.events.some((e) => !e.you && e.at > lastSeenActivity()) && setUnread(true))
      .catch(() => {});
    api
      .finAlerts()
      .then((d) => d.unread > 0 && setUnread(true))
      .catch(() => {});
  }, [api]);
  const first = user?.firstName || "";
  const o = fin.overview;
  const budget = useBudgetTotal(hasBanks(o));
  const tips = useTips(hasBanks(o));

  return (
    <div className="space-y-5 pt-1">
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <img src="/logo1.png" alt="" className="h-9 w-9 rounded-xl object-contain" />
          <span className="os-display text-[22px] font-extrabold tracking-tight">Mayel&apos;AI</span>
        </span>
        <span className="flex items-center gap-2">
          <Link to="/onsave/alerts" aria-label={t("alTitle")} className="relative inline-flex h-11 w-11 items-center justify-center rounded-full text-os-ink hover:bg-os-line-soft">
            <Bell className="h-[22px] w-[22px]" />
            {unread && <span className="absolute right-[10px] top-[9px] h-2.5 w-2.5 rounded-full border-2 border-os-bg bg-[#d9467f]" />}
          </Link>
          <Link to="/onsave/me" aria-label={t("tabMe")}>
            <Avatar name={user?.fullName || first} src={user?.hasImage ? user.imageUrl : undefined} size={40} />
          </Link>
        </span>
      </header>

      <div>
        <h1 className="os-display text-[26px] font-extrabold leading-tight">
          {first ? t("homeHello", { name: first }) : t("homeHelloNoName")} <span aria-hidden="true">👋</span>
        </h1>
        <p className="mt-1 text-[14px] text-os-muted">{t("homeTagline")}</p>
      </div>

      <ChatCard />
      <Tiles />

      {hasBanks(o) ? (
        <>
          <NetWorth o={o} hidden={hidden} toggle={toggle} />
          <Link to="/onsave/fin" className="block">
            <SpendCard o={o} hidden={hidden} budgetCents={budget} />
          </Link>
          <TipsCard data={tips} hidden={hidden} limit={1} />
        </>
      ) : (
        !fin.loading && fin.enabled && <ConnectCard fin={fin} compact />
      )}

      <OnSaveCard />
    </div>
  );
}
