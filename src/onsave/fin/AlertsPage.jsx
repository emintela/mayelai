import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  BookOpen,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Gauge,
  MessageSquareText,
  Users,
  Wallet,
} from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { centsToInput } from "@/lib/money";
import { cn } from "@/lib/utils";
import { AlertsCard } from "../money/shared";
import { ErrorNote, Spinner, card, iconBtn, money } from "../ui";
import { TipsCard, tipText, useTips } from "./shared";

const KIND = {
  over_budget: [AlertTriangle, "bg-[#fbe4ea] text-os-danger", "/onsave/budget"],
  near_budget: [Gauge, "bg-os-warn-soft text-os-warn", "/onsave/budget"],
  low_balance: [Wallet, "bg-os-brand-soft text-os-brand", "/onsave/fin?tab=accounts"],
  large_charge: [CreditCard, "bg-os-money-soft text-os-money", "/onsave/fin?tab=transactions"],
  bill_due: [CalendarClock, "bg-os-warn-soft text-os-warn", "/onsave/fin?tab=transactions"],
};
const BASICS = ["emergency_fund", "rule_50_30_20", "pay_yourself_first", "likelemba"];

function ago(iso, t) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return t("finJustNow");
  if (mins < 60) return t("finMinAgo", { n: mins });
  if (mins < 48 * 60) return t("finHoursAgo", { n: Math.floor(mins / 60) });
  return t("finDaysAgo", { n: Math.floor(mins / 1440) });
}

function AlertRow({ a }) {
  const t = useT();
  const lang = useLang();
  const [Icon, tone, to] = KIND[a.kind] || [Bell, "bg-os-line-soft text-os-muted", "/onsave/fin"];
  const category = a.category === "TOTAL" ? t("alTotal") : a.category ? t(`finCat_${a.category}`) : "";
  return (
    <Link to={to} className={cn(card, "flex items-start gap-3 p-3.5 transition hover:border-os-brand/40", !a.read && "border-os-brand/30")}>
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", tone)}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold">{t(`al_${a.kind}`)}</span>
          {!a.read && <span className="h-2 w-2 shrink-0 rounded-full bg-[#d9467f]" />}
        </span>
        <span className="block text-[13px] leading-snug text-os-muted">
          {t(`al_${a.kind}_body`, { category, name: a.name, amount: money(a.amount_cents, a.currency, lang) })}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[11px] text-os-muted">
        {ago(a.created_at, t)}
        <ChevronRight className="h-4 w-4" />
      </span>
    </Link>
  );
}

function Switch({ on, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn("relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-40", on ? "bg-os-btn" : "bg-os-line")}
    >
      <span className={cn("absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-6" : "left-1")} />
    </button>
  );
}

function SettingRow({ title, body, on, onToggle, amount, onAmount, currency, disabled, badge }) {
  const lang = useLang();
  const [text, setText] = useState(amount != null ? centsToInput(amount) : "");
  useEffect(() => setText(amount != null ? centsToInput(amount) : ""), [amount]);
  const commit = () => {
    const n = Math.round(Number(text.replace(",", ".")) * 100);
    if (Number.isFinite(n) && n >= 0 && n !== amount) onAmount(n);
    else setText(centsToInput(amount));
  };
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[15px] font-semibold">
          {title}
          {badge && <span className="rounded-full bg-os-line-soft px-2 py-0.5 text-[10px] font-bold uppercase text-os-muted">{badge}</span>}
        </span>
        <span className="block text-[12.5px] leading-snug text-os-muted">
          {body}
        </span>
        {amount != null && (
          <span className={cn("mt-1.5 inline-flex h-9 items-center gap-1 rounded-xl border border-os-line bg-os-bg px-3", !on && "opacity-50")}>
            <span className="text-[14px] font-semibold text-os-muted">{money(0, currency, lang).replace(/[\d.,\s\u00a0\u202f]/g, "") || currency}</span>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              inputMode="decimal"
              disabled={!on}
              aria-label={title}
              className="w-20 bg-transparent text-[15px] font-semibold text-os-ink outline-none"
            />
          </span>
        )}
      </span>
      <Switch on={on} onChange={onToggle} disabled={disabled} label={title} />
    </div>
  );
}

function Settings({ data, setData }) {
  const t = useT();
  const api = useApi();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const timer = useRef();
  const s = data.settings;
  const save = async (next) => {
    setData({ ...data, settings: next });
    setError(null);
    try {
      const out = await api.finSaveAlertSettings(next);
      setData((d) => ({ ...d, settings: out }));
      setSaved(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const cur = data.currency || "USD";
  return (
    <section className={cn(card, "px-4 py-2")}>
      <div className="flex items-center justify-between pt-2">
        <h2 className="text-[15px] font-bold">{t("alSettings")}</h2>
        {saved && <span className="text-xs font-semibold text-os-money">{t("alSaved")}</span>}
      </div>
      <div className="divide-y divide-os-line">
        <SettingRow title={t("alBudget")} body={t("alBudgetBody")} on={s.budget} onToggle={(v) => save({ ...s, budget: v })} />
        <SettingRow
          title={t("alLow")}
          body={t("alLowBody")}
          on={s.low_balance}
          onToggle={(v) => save({ ...s, low_balance: v })}
          amount={s.low_cents}
          onAmount={(n) => save({ ...s, low_cents: n })}
          currency={cur}
        />
        <SettingRow
          title={t("alLarge")}
          body={t("alLargeBody")}
          on={s.large}
          onToggle={(v) => save({ ...s, large: v })}
          amount={s.large_cents}
          onAmount={(n) => save({ ...s, large_cents: Math.max(n, 100) })}
          currency={cur}
        />
        <SettingRow title={t("alBills")} body={t("alBillsBody")} on={s.bills} onToggle={(v) => save({ ...s, bills: v })} />
        <SettingRow
          title={t("alSms")}
          body={t("alSmsBody")}
          on={s.sms}
          onToggle={(v) => save({ ...s, sms: v })}
          disabled={!data.sms_available}
          badge={data.sms_available ? null : t("alSmsSoon")}
        />
      </div>
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}

function Basics() {
  const t = useT();
  const lang = useLang();
  return (
    <section className={cn(card, "p-4")}>
      <p className="flex items-center gap-2 text-[14px] font-bold">
        <BookOpen className="h-4 w-4 text-os-brand" aria-hidden="true" /> {t("alLearn")}
      </p>
      <ul className="mt-2 space-y-2.5">
        {BASICS.map((k) => (
          <li key={k} className="text-[13.5px] leading-snug">
            {tipText({ kind: k }, "USD", t, lang, false)}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AlertsPage() {
  const t = useT();
  const api = useApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "tips" ? "tips" : "alerts";
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const tips = useTips(true);

  useEffect(() => {
    api
      .finAlerts()
      .then((d) => {
        setData((old) => ({ ...d, currency: old?.currency }));
        if (d.unread) api.finAlertsRead().catch(() => {});
      })
      .catch((e) => (e?.response?.status === 503 ? setData({ off: true }) : setError(errorText(e))));
  }, [api]);
  useEffect(() => {
    if (tips?.currency) setData((d) => (d ? { ...d, currency: tips.currency } : d));
  }, [tips]);

  return (
    <div className="space-y-4 pt-2">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/onsave"))} aria-label={t("back")} className={iconBtn}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-os-brand-soft text-os-brand">
          <Bell className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="os-display text-2xl font-extrabold">{t("alTitle")}</h1>
      </header>

      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-full bg-os-line-soft p-1">
        {[
          ["alerts", t("alAlerts")],
          ["tips", t("alTips")],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setParams(k === "alerts" ? {} : { tab: k }, { replace: true })}
            className={cn("h-10 rounded-full text-[14px] font-semibold transition", tab === k ? "bg-os-btn text-white shadow-sm" : "text-os-muted")}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorNote>{error}</ErrorNote>

      {tab === "alerts" && (
        <>
          {!data && !error && <Spinner />}
          {data && !data.off && (
            <>
              {data.alerts.length ? (
                <div className="space-y-2.5">
                  {data.alerts.map((a) => (
                    <AlertRow key={a.id} a={a} />
                  ))}
                </div>
              ) : (
                <p className={cn(card, "p-4 text-center text-[13px] text-os-muted")}>{t("alNone")}</p>
              )}
            </>
          )}
          <Link to="/onsave/activity" className={cn(card, "flex items-center gap-3 px-4 py-3 transition hover:border-os-brand/40")}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-os-deep text-os-mint">
              <Users className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">{t("alActivity")}</span>
              <span className="block truncate text-[13px] text-os-muted">{t("alActivityBody")}</span>
            </span>
            <ChevronRight className="h-5 w-5 text-os-muted" aria-hidden="true" />
          </Link>
          {data && !data.off && <Settings data={data} setData={setData} />}
          <div>
            <p className="mb-2 flex items-center gap-2 px-1 text-[13px] font-semibold text-os-muted">
              <MessageSquareText className="h-4 w-4" aria-hidden="true" /> {t("alPhone")}
            </p>
            <AlertsCard />
          </div>
        </>
      )}

      {tab === "tips" && (
        <>
          <TipsCard data={tips} />
          <Basics />
        </>
      )}
    </div>
  );
}
