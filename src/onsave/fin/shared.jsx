import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDownLeft,
  Banknote,
  Car,
  CircleDollarSign,
  Eye,
  EyeOff,
  HeartPulse,
  Home as HomeIcon,
  Landmark,
  Lightbulb,
  Loader2,
  PiggyBank,
  Plane,
  Plus,
  Receipt,
  ShoppingBag,
  Sparkles,
  Ticket,
  Utensils,
  Wrench,
} from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { todayISO } from "@/lib/money";
import { openPlaidLink } from "@/lib/plaid";
import { cn } from "@/lib/utils";
import { btnBrand, card, money } from "../ui";

// ---------- data ----------

const STALE_MS = 60 * 60 * 1000; // refresh from the bank when older than an hour

// Loads AI Fin; refreshes from the bank in the background when it's old.
export function useFin() {
  const api = useApi();
  const lang = useLang();
  const [state, setState] = useState({ enabled: null, overview: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // "connect" | "sync" | null
  const [error, setError] = useState(null);
  const refreshed = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await api.finOverview(todayISO());
      setState({ enabled: d.enabled, overview: d.overview || null });
      setError(null);
      return d;
    } catch (e) {
      setError(errorText(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, [api]);

  const refresh = useCallback(async () => {
    setBusy("sync");
    try {
      const o = await api.finRefresh(todayISO());
      setState({ enabled: true, overview: o });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }, [api]);

  useEffect(() => {
    load().then((d) => {
      const o = d?.overview;
      const banks = o?.banks || [];
      const old = banks.some((b) => !b.synced_at || Date.now() - new Date(b.synced_at).getTime() > STALE_MS);
      // Connected but no transactions yet: Plaid may still be loading them.
      const waiting = banks.length > 0 && !o.recent.length;
      if (d?.enabled && (old || waiting) && !refreshed.current) {
        refreshed.current = true;
        refresh();
      }
    });
  }, [load, refresh]);

  // While transactions are on their way, look again every few seconds (about 3 minutes).
  const waiting = !!state.overview?.banks?.length && !state.overview.recent.length;
  useEffect(() => {
    if (!waiting) return;
    let n = 0;
    const id = setInterval(() => {
      if (++n > 20) clearInterval(id);
      else load();
    }, 9000);
    return () => clearInterval(id);
  }, [waiting, load]);

  // Opens Plaid. With itemId, fixes a bank that needs a new sign-in.
  const connect = useCallback(
    async (itemId) => {
      setError(null);
      setBusy("connect");
      try {
        const { link_token } = await api.finLinkToken(itemId, lang);
        const res = await openPlaidLink(link_token);
        if (!res) return;
        if (itemId) {
          setBusy("sync");
          setState({ enabled: true, overview: await api.finRefresh(todayISO()) });
        } else {
          setBusy("sync");
          setState({ enabled: true, overview: await api.finConnect(res.publicToken, res.institution, todayISO()) });
        }
      } catch (e) {
        setError(e?.response ? errorText(e) : e?.message || errorText(e));
      } finally {
        setBusy(null);
      }
    },
    [api, lang]
  );

  const disconnect = useCallback(
    async (id) => {
      try {
        await api.finDisconnect(id);
        await load();
      } catch (e) {
        setError(errorText(e));
      }
    },
    [api, load]
  );

  return { ...state, loading, busy, error, connect, refresh, disconnect, reload: load };
}

export const hasBanks = (o) => !!o?.banks?.length;
export const accountCount = (o) => (o?.banks || []).reduce((n, b) => n + b.accounts.length, 0);

// "2 min ago" for the newest sync.
export function lastSynced(o, t) {
  const times = (o?.banks || []).map((b) => b.synced_at && new Date(b.synced_at).getTime()).filter(Boolean);
  if (!times.length) return "";
  const mins = Math.floor((Date.now() - Math.max(...times)) / 60000);
  if (mins < 1) return t("finJustNow");
  if (mins < 60) return t("finMinAgo", { n: mins });
  if (mins < 48 * 60) return t("finHoursAgo", { n: Math.floor(mins / 60) });
  return t("finDaysAgo", { n: Math.floor(mins / 1440) });
}

// ---------- amounts you can hide ----------

const HIDE_KEY = "mayelai.hideAmounts";
export function useHidden() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setHidden((h) => {
      try {
        localStorage.setItem(HIDE_KEY, h ? "0" : "1");
      } catch {
        /* private mode */
      }
      return !h;
    });
  return [hidden, toggle];
}

export function HideButton({ hidden, onToggle, className }) {
  const t = useT();
  return (
    <button type="button" onClick={onToggle} aria-label={hidden ? t("homeShow") : t("homeHide")} className={cn("rounded-full p-1.5 text-os-muted hover:text-os-ink", className)}>
      {hidden ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
    </button>
  );
}

export const shown = (hidden, text) => (hidden ? "••••••" : text);

// ---------- categories ----------

const CATS = {
  FOOD_AND_DRINK: [Utensils, "#5a3fd4"],
  RENT_AND_UTILITIES: [HomeIcon, "#d9467f"],
  TRANSPORTATION: [Car, "#2f7de1"],
  GENERAL_MERCHANDISE: [ShoppingBag, "#e0852b"],
  ENTERTAINMENT: [Ticket, "#a64fd9"],
  PERSONAL_CARE: [Sparkles, "#c2489b"],
  MEDICAL: [HeartPulse, "#d64545"],
  TRAVEL: [Plane, "#1b9aaa"],
  HOME_IMPROVEMENT: [Wrench, "#8a6d3b"],
  GENERAL_SERVICES: [Receipt, "#4f7a8a"],
  GOVERNMENT_AND_NON_PROFIT: [Landmark, "#6b6580"],
  BANK_FEES: [Banknote, "#b42345"],
  LOAN_PAYMENTS: [Landmark, "#6b6580"],
  TRANSFER_IN: [ArrowDownLeft, "#0b7a55"],
  TRANSFER_OUT: [CircleDollarSign, "#6b6580"],
  INCOME: [ArrowDownLeft, "#0b7a55"],
  OTHER: [CircleDollarSign, "#8f88a6"],
};
export const catColor = (c) => (CATS[c] || CATS.OTHER)[1];

export function CategoryIcon({ category, logo, size = 40 }) {
  const [Icon, color] = CATS[category] || CATS.OTHER;
  const [broken, setBroken] = useState(false);
  if (logo && !broken)
    return <img src={logo} alt="" width={size} height={size} onError={() => setBroken(true)} className="shrink-0 rounded-full border border-os-line bg-white object-contain" style={{ width: size, height: size }} />;
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full" style={{ width: size, height: size, background: `${color}1f`, color }}>
      <Icon className="h-[45%] w-[45%]" aria-hidden="true" />
    </span>
  );
}

export function TxnRow({ x, hidden }) {
  const t = useT();
  const lang = useLang();
  const income = x.amount_cents < 0;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <CategoryIcon category={x.category} logo={x.logo_url} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{x.merchant || x.name}</span>
        <span className="block truncate text-[12px] text-os-muted">
          {t(`finCat_${x.category}`) || x.category} · {new Date(`${x.date}T12:00:00`).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { month: "short", day: "numeric" })}
          {x.pending && ` · ${t("finPending")}`}
        </span>
      </span>
      <span className={cn("os-display shrink-0 text-[15px] font-bold", income && "text-os-money")}>
        {shown(hidden, `${income ? "+" : "−"}${money(Math.abs(x.amount_cents), x.currency, lang)}`)}
      </span>
    </li>
  );
}

// ---------- cards ----------

export function ConnectCard({ fin, compact }) {
  const t = useT();
  if (fin.enabled === false)
    return <p className={cn(card, "p-4 text-center text-[13px] text-os-muted")}>{t("finNotAvailable")}</p>;
  return (
    <section className={cn(card, "relative overflow-hidden p-5")}>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-os-brand-soft text-os-brand">
        <Landmark className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="os-display mt-3 text-lg font-extrabold">{compact ? t("homeConnectTitle") : t("finEmptyTitle")}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-os-muted">{compact ? t("homeConnectBody") : t("finEmptyBody")}</p>
      <ConnectButton fin={fin} className="mt-4 w-full" />
    </section>
  );
}

export function ConnectButton({ fin, className, label }) {
  const t = useT();
  const busy = fin.busy === "connect";
  return (
    <button type="button" disabled={!!fin.busy} onClick={() => fin.connect()} className={cn(btnBrand, className)}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
      {busy ? t("finConnecting") : label || t("finConnect")}
    </button>
  );
}

// The month's total budget (overall, or the sum of categories); 0 when none.
export function useBudgetTotal(enabled = true) {
  const api = useApi();
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    api.finBudgets(undefined, todayISO()).then((v) => setTotal(v.total_cents || 0)).catch(() => {});
  }, [api, enabled]);
  return total;
}

// "This month's spend": against the budget when there is one, else against
// last month at the same date.
export function SpendCard({ o, hidden, budgetCents = 0, className }) {
  const t = useT();
  const lang = useLang();
  const m = o.month;
  let chip = null;
  let width;
  let bar = "bg-os-brand";
  if (budgetCents > 0) {
    const p = Math.round((m.spent_cents / budgetCents) * 100);
    width = Math.min(p, 100);
    const tone = p > 100 ? "bg-[#fbe4ea] text-os-danger" : p >= 80 ? "bg-os-warn-soft text-os-warn" : "bg-os-money-soft text-os-money";
    bar = p > 100 ? "bg-os-danger" : "bg-os-brand";
    chip = <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", tone)}>{p}%</span>;
  } else {
    const base = Math.max(m.spent_cents, m.last_month_cents, 1);
    width = Math.min(100, (m.spent_cents / base) * 100);
    if (m.last_month_cents) {
      const p = Math.round(((m.spent_cents - m.last_month_cents) / m.last_month_cents) * 100);
      chip = (
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", p > 0 ? "bg-os-warn-soft text-os-warn" : "bg-os-money-soft text-os-money")}>
          {p > 0 ? "+" : ""}
          {p}%
        </span>
      );
    }
  }
  return (
    <section className={cn(card, "p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[14px] font-bold">{t("homeMonthSpend")}</p>
        {!hidden && chip}
      </div>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="os-display text-[26px] font-extrabold leading-tight">{shown(hidden, money(m.spent_cents, o.currency, lang))}</span>
        {budgetCents > 0 && <span className="text-[14px] text-os-muted">{t("budOfBudget", { amount: shown(hidden, money(budgetCents, o.currency, lang)) })}</span>}
      </p>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-os-line-soft">
        <div className={cn("h-full rounded-full", bar)} style={{ width: `${width}%` }} />
      </div>
      {budgetCents === 0 && m.last_month_cents > 0 && (
        <p className="mt-2 text-xs text-os-muted">{t("homeVsLast", { amount: shown(hidden, money(m.last_month_cents, o.currency, lang)) })}</p>
      )}
    </section>
  );
}

// ---------- tips ----------

export function useTips(reloadKey) {
  const api = useApi();
  const [tips, setTips] = useState(null);
  useEffect(() => {
    api.finTips(todayISO()).then(setTips).catch(() => setTips(null));
  }, [api, reloadKey]);
  return tips;
}

const TONE = {
  warn: [AlertTriangle, "bg-os-warn-soft text-os-warn"],
  info: [Lightbulb, "bg-os-brand-soft text-os-brand"],
  good: [PiggyBank, "bg-os-money-soft text-os-money"],
};

export function tipText(x, currency, t, lang, hidden) {
  return t(`tip_${x.kind}`, {
    category: x.category ? t(`finCat_${x.category}`) : "",
    amount: shown(hidden, money(x.amount_cents || 0, currency, lang)),
    percent: x.percent ?? 0,
    pace: x.count ?? 0,
    count: x.count ?? 0,
    names: (x.names || []).join(", "),
  });
}

export function TipsCard({ data, hidden, className, limit = 6 }) {
  const t = useT();
  const lang = useLang();
  if (!data?.tips?.length) return null;
  return (
    <section className={cn(card, "p-4", className)}>
      <p className="text-[14px] font-bold">{t("tipsTitle")}</p>
      <ul className="mt-2 space-y-2.5">
        {data.tips.slice(0, limit).map((x, i) => {
          const [Icon, tone] = TONE[x.tone] || TONE.info;
          const to = x.kind === "make_budget" || x.kind.endsWith("budget") || x.kind === "ahead_of_pace" ? "/onsave/budget" : null;
          const body = (
            <>
              <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", tone)}>
                <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 text-[13.5px] leading-snug">{tipText(x, data.currency, t, lang, hidden)}</span>
            </>
          );
          return (
            <li key={`${x.kind}-${x.category || i}`}>
              {to ? (
                <Link to={to} className="flex items-start gap-3">
                  {body}
                </Link>
              ) : (
                <div className="flex items-start gap-3">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
