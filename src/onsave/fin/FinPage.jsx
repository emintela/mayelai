import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Bell, CheckCircle2, ChevronRight, CreditCard, PieChart, Landmark, LineChart, Loader2, RefreshCw, Search, Sparkles, Trash2, Wallet } from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ErrorNote, Spinner, card, iconBtn, money, smallBtn } from "../ui";
import {
  ConnectButton,
  ConnectCard,
  HideButton,
  SpendCard,
  TipsCard,
  TxnRow,
  accountCount,
  catColor,
  hasBanks,
  lastSynced,
  shown,
  useBudgetTotal,
  useFin,
  useHidden,
  useTips,
} from "./shared";

const TABS = ["overview", "accounts", "transactions"];
const TYPE_ICON = { depository: Wallet, credit: CreditCard, loan: Landmark, investment: LineChart, other: Wallet };

function Header() {
  const t = useT();
  const api = useApi();
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    api
      .finAlerts()
      .then((d) => setUnread(d.unread > 0))
      .catch(() => {});
  }, [api]);
  return (
    <header className="flex items-center gap-3">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-os-brand text-white">
        <Sparkles className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="os-display text-2xl font-extrabold leading-tight">{t("finTitle")}</h1>
        <p className="truncate text-[13px] text-os-muted">{t("finSubtitle")}</p>
      </div>
      <Link to="/onsave/alerts" aria-label={t("alTitle")} className={cn(iconBtn, "relative")}>
        <Bell className="h-5 w-5" />
        {unread && <span className="absolute right-[11px] top-[10px] h-2.5 w-2.5 rounded-full border-2 border-os-card bg-[#d9467f]" />}
      </Link>
    </header>
  );
}

function StatusRow({ fin }) {
  const t = useT();
  const o = fin.overview;
  const n = accountCount(o);
  const syncing = fin.busy === "sync";
  return (
    <section className={cn(card, "flex items-center gap-3 px-4 py-3")}>
      <CheckCircle2 className="h-7 w-7 shrink-0 text-os-money" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">{t("finConnectedWith")}</p>
        <p className="truncate text-xs text-os-muted">
          {n === 1 ? t("finAccountsCount1") : t("finAccountsCount", { n })}
          {" · "}
          {syncing ? t("finSyncing") : t("finUpdated", { when: lastSynced(o, t) })}
        </p>
      </div>
      <button type="button" onClick={fin.refresh} disabled={!!fin.busy} aria-label={t("finRefresh")} className={cn(iconBtn, "h-10 w-10")}>
        <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
      </button>
    </section>
  );
}

function Relink({ fin }) {
  const t = useT();
  return fin.overview.banks
    .filter((b) => b.status === "relink")
    .map((b) => (
      <section key={b.id} className="flex items-start gap-3 rounded-3xl bg-os-warn-soft p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-os-warn" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">{t("finRelink")}</p>
          <p className="text-[13px] text-os-muted">{t("finRelinkBody", { bank: b.institution_name || "—" })}</p>
          <button type="button" disabled={!!fin.busy} onClick={() => fin.connect(b.id)} className={cn(smallBtn, "mt-2")}>
            {t("finRelink")}
          </button>
        </div>
      </section>
    ));
}

function AccountLine({ a, hidden, detail }) {
  const t = useT();
  const lang = useLang();
  const Icon = TYPE_ICON[a.type] || Wallet;
  const owed = a.type === "credit" || a.type === "loan";
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", owed ? "bg-os-warn-soft text-os-warn" : "bg-os-brand-soft text-os-brand")}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{a.name}</span>
        <span className="block truncate text-xs text-os-muted">
          {t(`finType_${a.type}`)}
          {a.mask && ` •••• ${a.mask}`}
          {detail && a.available_cents != null && !owed && ` · ${t("finAvailable", { amount: shown(hidden, money(a.available_cents, a.currency, lang)) })}`}
          {detail && a.limit_cents != null && owed && ` · ${t("finLimit", { amount: shown(hidden, money(a.limit_cents, a.currency, lang)) })}`}
        </span>
      </span>
      <span className={cn("os-display shrink-0 text-[15px] font-bold", owed && "text-os-danger")}>
        {a.current_cents == null ? "—" : shown(hidden, `${owed ? "−" : ""}${money(a.current_cents, a.currency, lang)}`)}
      </span>
    </li>
  );
}

function Overview({ fin, hidden, toggle, goTab }) {
  const t = useT();
  const lang = useLang();
  const o = fin.overview;
  const accounts = o.banks.flatMap((b) => b.accounts);
  const cats = o.month.by_category.slice(0, 6);
  const budget = useBudgetTotal();
  const tips = useTips(o);
  const total = Math.max(o.month.spent_cents, 1);
  return (
    <>
      <StatusRow fin={fin} />
      <Relink fin={fin} />
      <section className={cn(card, "p-4")}>
        <div className="flex items-center justify-between">
          <p className="text-[14px] font-bold">{t("finTotal")}</p>
          <HideButton hidden={hidden} onToggle={toggle} />
        </div>
        <p className="os-display text-[32px] font-extrabold leading-tight">{shown(hidden, money(o.net_cents, o.currency, lang))}</p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <span className="rounded-2xl bg-os-money-soft px-3 py-2">
            <span className="block text-os-muted">{t("finCash")}</span>
            <span className="os-display block text-[14px] font-bold text-os-money">{shown(hidden, money(o.cash_cents, o.currency, lang))}</span>
          </span>
          <span className="rounded-2xl bg-os-line-soft px-3 py-2">
            <span className="block text-os-muted">{t("finOwed")}</span>
            <span className="os-display block text-[14px] font-bold">{shown(hidden, money(o.owed_cents, o.currency, lang))}</span>
          </span>
        </div>
        {o.other_currencies && <p className="mt-1 text-xs text-os-muted">{t("finOtherCurrencies")}</p>}
        <ul className="mt-2 divide-y divide-os-line">
          {accounts.slice(0, 4).map((a) => (
            <AccountLine key={a.id} a={a} hidden={hidden} />
          ))}
        </ul>
        {accounts.length > 4 && (
          <button type="button" onClick={() => goTab("accounts")} className="mt-1 text-[13px] font-semibold text-os-brand">
            {t("finSeeAll")}
          </button>
        )}
        <ConnectButton fin={fin} label={t("finAddAccount")} className="mt-3 min-h-11 w-full border border-os-brand/20 bg-os-brand-soft text-os-brand-ink hover:bg-os-brand-soft" />
      </section>

      <SpendCard o={o} hidden={hidden} budgetCents={budget} />
      <Link to="/onsave/budget" className={cn(card, "flex items-center gap-3 px-4 py-3 transition hover:border-os-brand/40")}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-os-brand-soft text-os-brand">
          <PieChart className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{t("budTitle")}</span>
          <span className="block truncate text-[13px] text-os-muted">{budget ? t("budMonthly", { amount: shown(hidden, money(budget, o.currency, lang)) }) : t("tip_make_budget")}</span>
        </span>
        <ChevronRight className="h-5 w-5 text-os-muted" aria-hidden="true" />
      </Link>
      <TipsCard data={tips} hidden={hidden} />

      {cats.length > 0 && (
        <section className={cn(card, "space-y-3 p-4")}>
          <p className="text-[14px] font-bold">{t("finByCategory")}</p>
          {cats.map((c) => (
            <Link key={c.category} to={`/onsave/fin?tab=transactions&category=${c.category}`} className="block">
              <span className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="font-semibold">{t(`finCat_${c.category}`)}</span>
                <span className="text-os-muted">
                  {shown(hidden, money(c.cents, o.currency, lang))} · {Math.round((c.cents / total) * 100)}%
                </span>
              </span>
              <span className="mt-1 block h-2 overflow-hidden rounded-full bg-os-line-soft">
                <span className="block h-full rounded-full" style={{ width: `${(c.cents / total) * 100}%`, background: catColor(c.category) }} />
              </span>
            </Link>
          ))}
        </section>
      )}

      <section className={cn(card, "p-4")}>
        <div className="flex items-baseline justify-between">
          <p className="text-[14px] font-bold">{t("finRecent")}</p>
          <button type="button" onClick={() => goTab("transactions")} className="text-[13px] font-semibold text-os-brand">
            {t("finSeeAll")}
          </button>
        </div>
        {o.recent.length ? (
          <ul className="divide-y divide-os-line">
            {o.recent.map((x) => (
              <TxnRow key={x.id} x={x} hidden={hidden} />
            ))}
          </ul>
        ) : (
          <p className="py-3 text-[13px] text-os-muted">{t("finNoTxns")}</p>
        )}
      </section>

      <Link to="/onsave/ask?fin=1" className="flex items-center justify-center gap-2 rounded-full bg-os-deep py-3 text-[15px] font-semibold text-white">
        <Sparkles className="h-4 w-4 text-os-mint" /> {t("finAskMayele")}
      </Link>
    </>
  );
}

function Accounts({ fin, hidden }) {
  const t = useT();
  const remove = (b) => {
    if (window.confirm(t("finDisconnectAsk", { bank: b.institution_name || "—" }))) fin.disconnect(b.id);
  };
  return (
    <>
      <Relink fin={fin} />
      {fin.overview.banks.map((b) => (
        <section key={b.id} className={cn(card, "p-4")}>
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[15px] font-bold">{b.institution_name || t("finType_depository")}</p>
            <button type="button" onClick={() => remove(b)} className={cn(smallBtn, "text-os-danger")}>
              <Trash2 className="h-3.5 w-3.5" /> {t("finDisconnect")}
            </button>
          </div>
          <ul className="mt-1 divide-y divide-os-line">
            {b.accounts.map((a) => (
              <AccountLine key={a.id} a={a} hidden={hidden} detail />
            ))}
          </ul>
        </section>
      ))}
      <ConnectButton fin={fin} label={t("finAddAccount")} className="w-full" />
    </>
  );
}

function Transactions({ fin, hidden }) {
  const t = useT();
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const category = params.get("category") || "";
  const account = params.get("account") || "";
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(null);
  const PAGE = 40;

  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => {
    let live = true;
    setRows(null);
    api
      .finTransactions({ category, account, q: query, limit: PAGE })
      .then((d) => {
        if (!live) return;
        setRows(d.transactions);
        setMore(d.transactions.length === PAGE);
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [api, category, account, query, fin.overview]);

  const loadMore = async () => {
    try {
      const d = await api.finTransactions({ category, account, q: query, limit: PAGE, offset: rows.length });
      setRows([...rows, ...d.transactions]);
      setMore(d.transactions.length === PAGE);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const set = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const cats = fin.overview.month.by_category.map((c) => c.category);
  if (category && !cats.includes(category)) cats.unshift(category);
  const accounts = fin.overview.banks.flatMap((b) => b.accounts);

  return (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-os-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("finSearch")}
          aria-label={t("finSearch")}
          className="h-11 w-full rounded-2xl border border-os-line bg-os-card pl-10 pr-4 text-base outline-none focus:border-os-brand"
        />
      </div>
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        {["", ...cats].map((c) => (
          <button
            key={c || "all"}
            type="button"
            onClick={() => set("category", c)}
            className={cn(smallBtn, category === c && "border-os-brand bg-os-brand-soft text-os-brand-ink")}
          >
            {c ? t(`finCat_${c}`) : t("finAllCategories")}
          </button>
        ))}
      </div>
      {accounts.length > 1 && (
        <select
          value={account}
          onChange={(e) => set("account", e.target.value)}
          aria-label={t("finAccounts")}
          className="h-11 w-full rounded-2xl border border-os-line bg-os-card px-3 text-[15px] outline-none focus:border-os-brand"
        >
          <option value="">{t("finAllAccounts")}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.mask ? ` •••• ${a.mask}` : ""}
            </option>
          ))}
        </select>
      )}
      <ErrorNote>{error}</ErrorNote>
      <section className={cn(card, "px-4 py-1")}>
        {!rows ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-os-muted" />
          </div>
        ) : rows.length ? (
          <ul className="divide-y divide-os-line">
            {rows.map((x) => (
              <TxnRow key={x.id} x={x} hidden={hidden} />
            ))}
          </ul>
        ) : (
          <p className="py-4 text-[13px] text-os-muted">{t("finNoTxns")}</p>
        )}
      </section>
      {more && (
        <button type="button" onClick={loadMore} className={cn(smallBtn, "mx-auto")}>
          {t("finLoadMore")}
        </button>
      )}
    </>
  );
}

export default function FinPage() {
  const t = useT();
  const fin = useFin();
  const [hidden, toggle] = useHidden();
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get("tab")) ? params.get("tab") : "overview";
  const goTab = (k) => setParams(k === "overview" ? {} : { tab: k }, { replace: true });
  const connected = hasBanks(fin.overview);

  return (
    <div className="space-y-4 pt-2">
      <Header />
      {connected && (
        <div role="tablist" className="grid grid-cols-3 gap-1 rounded-full bg-os-line-soft p-1">
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => goTab(k)}
              className={cn("h-10 rounded-full text-[13px] font-semibold transition", tab === k ? "bg-os-btn text-white shadow-sm" : "text-os-muted")}
            >
              {t(`fin${k[0].toUpperCase()}${k.slice(1)}`)}
            </button>
          ))}
        </div>
      )}
      <ErrorNote>{fin.error}</ErrorNote>
      {fin.loading && <Spinner />}
      {!fin.loading && !connected && fin.busy !== "sync" && <ConnectCard fin={fin} />}
      {!connected && fin.busy === "sync" && (
        <p className="flex items-center justify-center gap-2 py-6 text-sm text-os-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("finSyncing")}
        </p>
      )}
      {connected && tab === "overview" && <Overview fin={fin} hidden={hidden} toggle={toggle} goTab={goTab} />}
      {connected && tab === "accounts" && <Accounts fin={fin} hidden={hidden} />}
      {connected && tab === "transactions" && <Transactions fin={fin} hidden={hidden} />}
      {!fin.loading && fin.enabled !== false && <p className="px-2 text-center text-xs text-os-muted">{t("finPrivacy")}</p>}
    </div>
  );
}
