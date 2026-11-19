import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Bell, BellOff, Gift, HandHeart, Receipt } from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { formatDate, requestLink, shareLink } from "@/lib/money";
import { disablePush, enablePush, pushState } from "@/lib/push";
import { cn } from "@/lib/utils";
import { Chip, ErrorNote, LinkCard, btnBrand, card, field, label, money, smallBtn } from "../ui";

// ---------- what each kind means ----------

// Money goes to the owner for every kind except a gift.
export const ownerReceives = (r) => r.kind !== "gift";

export function KindIcon({ kind, size = 40 }) {
  const box = "flex shrink-0 items-center justify-center rounded-full";
  const s = { width: size, height: size };
  const i = "h-[45%] w-[45%]";
  if (kind === "gift") return <span style={s} className={cn(box, "bg-os-brand-soft text-os-brand")}><Gift className={i} /></span>;
  if (kind === "help") return <span style={s} className={cn(box, "bg-os-warn-soft text-os-warn")}><HandHeart className={i} /></span>;
  if (kind === "owed") return <span style={s} className={cn(box, "bg-os-money-soft text-os-money")}><Receipt className={i} /></span>;
  if (kind === "lent") return <span style={s} className={cn(box, "bg-os-money-soft text-os-money")}><ArrowUpRight className={i} /></span>;
  if (kind === "borrowed") return <span style={s} className={cn(box, "bg-os-warn-soft text-os-warn")}><ArrowDownLeft className={i} /></span>;
  return <span style={s} className={cn(box, "bg-os-brand-soft text-os-brand")}><ArrowDownLeft className={i} /></span>;
}

export function StatusChip({ status }) {
  const t = useT();
  const tone = { pending: "muted", countered: "warn", accepted: "brand", declined: "muted", sent: "warn", received: "money", cancelled: "muted" }[status];
  return <Chip tone={tone}>{t(`osmSt_${status}`)}</Chip>;
}

// The WhatsApp / SMS text for one person.
export function messageFor({ kind, name, cents, currency, note, due, token, loan }, t, lang) {
  const amount = money(cents, currency, lang);
  const why = note ? t("osmWhy", { note }) : "";
  const by = due ? t("osmBy", { date: formatDate(due, lang) }) : "";
  const link = loan ? shareLink(token) : requestLink(token);
  return t(`osmMsg_${loan ? "lend" : kind}`, { name, amount, why, by, link });
}

// ---------- rows ----------

// A request you made.
export function MineRow({ r }) {
  const t = useT();
  const lang = useLang();
  const needsYou = r.status === "countered" || (r.status === "sent" && ownerReceives(r));
  return (
    <LinkCard to={`/onsave/money/requests/${r.id}`} className="flex items-center gap-3 rounded-2xl px-3.5 py-3">
      <KindIcon kind={r.kind} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{t(`osmRow_${r.kind}`, { name: r.counterparty_name })}</span>
        <span className="block truncate text-[13px] text-os-muted">
          {needsYou ? <span className="font-semibold text-os-warn">{t(`osmNeedsYou_${r.status}`)}</span> : r.note || formatDate(r.created_at.slice(0, 10), lang)}
          {r.split_id && ` · ${t("osmSplitTag")}`}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="os-display text-[15px] font-bold">{money(r.amount_cents, r.currency, lang)}</span>
        <StatusChip status={r.status} />
      </span>
    </LinkCard>
  );
}

// A request someone sent you (opens the reply page).
export function ForMeRow({ r }) {
  const t = useT();
  const lang = useLang();
  return (
    <LinkCard to={`/r/${r.token}`} className="flex items-center gap-3 rounded-2xl px-3.5 py-3">
      <KindIcon kind={r.kind} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{t(`osmIn_${r.kind}`, { name: r.owner_name || "?" })}</span>
        <span className="block truncate text-[13px] text-os-muted">{r.note || formatDate(r.created_at.slice(0, 10), lang)}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="os-display text-[15px] font-bold">{money(r.amount_cents, r.currency, lang)}</span>
        <StatusChip status={r.status} />
      </span>
    </LinkCard>
  );
}

// Does a request someone sent you need your answer?
export function forMeNeedsYou(r) {
  if (r.kind === "gift") return r.status === "sent";
  return r.status === "pending" || r.status === "accepted";
}

// ---------- people balances ----------

const personKey = (name) => (name || "").trim().toLowerCase();

// Net per person and currency: + they owe you, − you owe them.
// Open loans count what's left; open "owed" requests count in full.
export function balances(loans, mine, forMe) {
  const people = new Map();
  const add = (name, currency, cents) => {
    const k = personKey(name);
    if (!k) return;
    const p = people.get(k) ?? { name: name.trim(), totals: {} };
    p.totals[currency] = (p.totals[currency] ?? 0) + cents;
    people.set(k, p);
  };
  for (const l of loans) {
    if (l.status !== "open") continue;
    add(l.counterparty_name, l.currency, l.direction === "lent" ? l.outstanding_cents : -l.outstanding_cents);
  }
  const open = (r) => ["pending", "countered", "accepted", "sent"].includes(r.status);
  for (const r of mine) if (r.kind === "owed" && open(r)) add(r.counterparty_name, r.currency, r.amount_cents);
  for (const r of forMe) if (r.kind === "owed" && open(r)) add(r.owner_name, r.currency, -r.amount_cents);
  return [...people.values()]
    .map((p) => ({ ...p, totals: Object.entries(p.totals).filter(([, v]) => v !== 0) }))
    .filter((p) => p.totals.length)
    .sort((a, b) => Math.abs(b.totals[0][1]) - Math.abs(a.totals[0][1]));
}

// ---------- alerts ----------

export function AlertsCard({ compact = false, labelKey = "osmAlertWhenAnswer" }) {
  const t = useT();
  const lang = useLang();
  const api = useApi();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [tested, setTested] = useState(false);
  useEffect(() => {
    pushState().then(setState).catch(() => setState("unsupported"));
  }, []);
  if (!state) return null;
  if (compact && state !== "off") return null;
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      setState(await fn());
    } catch (err) {
      setError(err?.response ? errorText(err) : err?.message || errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const noWorker = state === "off" && import.meta.env.DEV;
  const note = {
    blocked: t("osmAlertsBlocked"),
    "ios-install": t("osmAlertsIos"),
    unsupported: t("osmAlertsUnsupported"),
  }[state];

  if (compact)
    return (
      <button type="button" disabled={busy} onClick={() => run(() => enablePush(api, lang))} className={cn(smallBtn, "min-h-11 w-full justify-center text-sm")}>
        <Bell className="h-4 w-4 text-os-brand" /> {t(labelKey)}
      </button>
    );

  return (
    <section className={cn(card, "space-y-3 p-4")}>
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-os-brand-soft text-os-brand">
          {state === "on" ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">{t("osmAlerts")}</p>
          <p className="text-[13px] text-os-muted">{state === "on" ? t("osmAlertsOn") : t("osmAlertsBody")}</p>
        </div>
      </div>
      {note && <p className="rounded-2xl bg-os-bg p-3 text-[13px]">{note}</p>}
      {noWorker && <p className="rounded-2xl bg-os-bg p-3 text-[13px]">{t("osmAlertsDev")}</p>}
      <ErrorNote>{error}</ErrorNote>
      {state === "off" && !noWorker && (
        <button type="button" disabled={busy} onClick={() => run(() => enablePush(api, lang))} className={cn(btnBrand, "w-full")}>
          <Bell className="h-4 w-4" /> {t("osmTurnOn")}
        </button>
      )}
      {state === "on" && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy || tested}
            onClick={() => api.pushTest().then(() => setTested(true)).catch((e) => setError(errorText(e)))}
            className={smallBtn}
          >
            <Bell className="h-3.5 w-3.5" /> {t("osmTest")}
          </button>
          <button type="button" disabled={busy} onClick={() => run(() => disablePush(api))} className={smallBtn}>
            <BellOff className="h-3.5 w-3.5" /> {t("osmTurnOff")}
          </button>
        </div>
      )}
    </section>
  );
}

// ---------- how people pay you ----------

const HANDLES = [
  ["cashtag", "osmCashtag", "$"],
  ["venmo", "osmVenmo", "@"],
  ["paypal", "osmPaypal", ""],
  ["zelle", "osmZelle", ""],
  ["interac", "osmInterac", ""],
  ["mobile_money", "osmMobileMoney", ""],
];

export function PayHandlesCard() {
  const t = useT();
  const api = useApi();
  const [p, setP] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.getPayProfile().then(setP).catch((e) => setError(errorText(e)));
  }, [api]);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setP(await api.savePayProfile(p));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className={cn(card, "space-y-3 p-4")}>
      <div>
        <p className="text-[15px] font-semibold">{t("osmPayHandles")}</p>
        <p className="text-[13px] text-os-muted">{t("osmPayHandlesBody")}</p>
      </div>
      {p &&
        HANDLES.map(([k, key, prefix]) => (
          <label key={k} className="block">
            <span className={label}>{t(key)}</span>
            <span className="relative block">
              {prefix && <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-os-muted">{prefix}</span>}
              <input
                value={p[k]}
                maxLength={k === "zelle" || k === "interac" ? 80 : 40}
                autoCapitalize="none"
                autoCorrect="off"
                onChange={(e) => setP({ ...p, [k]: e.target.value })}
                className={cn(field, prefix && "pl-8")}
              />
            </span>
          </label>
        ))}
      <ErrorNote>{error}</ErrorNote>
      <button disabled={busy || !p} className={cn(btnBrand, "w-full")}>
        {saved ? t("osmSaved") : t("osmSave")}
      </button>
    </form>
  );
}
