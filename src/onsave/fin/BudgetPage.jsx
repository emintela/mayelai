import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Loader2, PieChart, Plus, Target, Trash2, Wand2, X } from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { centsToInput, todayISO } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ErrorNote, Spinner, btnBrand, card, field, iconBtn, label, money, smallBtn } from "../ui";
import { CategoryIcon, ConnectButton, TipsCard, catColor, useFin, useTips } from "./shared";

// Categories people can budget for, in the order the picker shows them.
const CATEGORIES = [
  "FOOD_AND_DRINK",
  "RENT_AND_UTILITIES",
  "TRANSPORTATION",
  "GENERAL_MERCHANDISE",
  "ENTERTAINMENT",
  "PERSONAL_CARE",
  "MEDICAL",
  "TRAVEL",
  "HOME_IMPROVEMENT",
  "GENERAL_SERVICES",
  "GOVERNMENT_AND_NON_PROFIT",
  "BANK_FEES",
  "OTHER",
];

const toCents = (s) => {
  const n = Number(String(s).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
const thisMonth = () => todayISO().slice(0, 7);
const shiftMonth = (m, by) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const barColor = (p) => (p > 100 ? "bg-os-danger" : p >= 80 ? "bg-[#e0a52b]" : "bg-os-money");
const chipColor = (p) => (p > 100 ? "bg-[#fbe4ea] text-os-danger" : p >= 80 ? "bg-os-warn-soft text-os-warn" : "bg-os-money-soft text-os-money");

function MonthPicker({ month, setMonth }) {
  const t = useT();
  const lang = useLang();
  const label = new Date(`${month}-15T12:00:00`).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { month: "long", year: "numeric" });
  const latest = month >= thisMonth();
  return (
    <div className="mx-auto flex w-fit items-center gap-1 rounded-full border border-os-line bg-os-card p-1">
      <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="‹" className="rounded-full p-2 hover:bg-os-line-soft">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-32 text-center text-[15px] font-semibold capitalize">{label}</span>
      <button
        type="button"
        disabled={latest}
        onClick={() => setMonth(shiftMonth(month, 1))}
        aria-label="›"
        className="rounded-full p-2 hover:bg-os-line-soft disabled:opacity-30"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <span className="sr-only">{t("budTitle")}</span>
    </div>
  );
}

// Spending by category as a ring, with the total in the middle.
function Donut({ v }) {
  const t = useT();
  const lang = useLang();
  const R = 52;
  const C = 2 * Math.PI * R;
  const cats = v.by_category.slice(0, 6);
  const rest = v.by_category.slice(6).reduce((n, c) => n + c.cents, 0);
  const parts = rest > 0 ? [...cats, { category: "OTHER", cents: rest, rest: true }] : cats;
  const total = Math.max(v.spent_cents, 1);
  let offset = 0;
  return (
    <section className={cn(card, "flex items-center gap-4 p-4")}>
      <div className="relative h-36 w-36 shrink-0">
        <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="64" cy="64" r={R} fill="none" stroke="var(--os-line-soft)" strokeWidth="16" />
          {parts.map((p) => {
            const len = (p.cents / total) * C;
            const el = (
              <circle
                key={p.category + (p.rest ? "-rest" : "")}
                cx="64"
                cy="64"
                r={R}
                fill="none"
                stroke={catColor(p.category)}
                strokeWidth="16"
                strokeDasharray={`${Math.max(len - 1.5, 0)} ${C}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="os-display max-w-24 text-[15px] font-extrabold leading-tight">{money(v.spent_cents, v.currency, lang)}</span>
          <span className="text-[11px] text-os-muted">{t("budSpent")}</span>
          {v.total_cents > 0 && <span className="text-[11px] font-semibold text-os-muted">({pct(v.spent_cents, v.total_cents)}%)</span>}
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {parts.length === 0 && <li className="text-[13px] text-os-muted">{t("budNoSpend")}</li>}
        {parts.map((p) => (
          <li key={p.category + (p.rest ? "-rest" : "")} className="flex items-center gap-2 text-[12.5px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: catColor(p.category) }} />
            <span className="min-w-0 flex-1 truncate">{t(`finCat_${p.category}`)}</span>
            <span className="text-os-muted">{pct(p.cents, total)}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BudgetRow({ b, currency, onEdit, overall }) {
  const t = useT();
  const lang = useLang();
  const p = pct(b.spent_cents, b.amount_cents);
  const left = b.amount_cents - b.spent_cents;
  return (
    <li>
      <button type="button" onClick={onEdit} className="flex w-full items-center gap-3 py-3 text-left">
        {overall ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-os-brand-soft text-os-brand">
            <Target className="h-5 w-5" aria-hidden="true" />
          </span>
        ) : (
          <CategoryIcon category={b.category} />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-[15px] font-semibold">{overall ? t("budOverall") : t(`finCat_${b.category}`)}</span>
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-bold", chipColor(p))}>{p}%</span>
          </span>
          <span className="mt-0.5 flex items-baseline justify-between gap-2 text-[13px]">
            <span>
              <span className="font-semibold">{money(b.spent_cents, currency, lang)}</span>
              <span className="text-os-muted"> / {money(b.amount_cents, currency, lang)}</span>
            </span>
            <span className={cn("text-xs", left < 0 ? "font-semibold text-os-danger" : "text-os-muted")}>
              {left < 0 ? t("budOver", { amount: money(-left, currency, lang) }) : t("budLeft", { amount: money(left, currency, lang) })}
            </span>
          </span>
          <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-os-line-soft">
            <span className={cn("block h-full rounded-full", barColor(p))} style={{ width: `${Math.min(p, 100)}%` }} />
          </span>
        </span>
      </button>
    </li>
  );
}

function BudgetSheet({ edit, used, currency, onClose, onSaved }) {
  const t = useT();
  const api = useApi();
  const lang = useLang();
  const isNew = !edit.amount_cents;
  const options = isNew ? ["TOTAL", ...CATEGORIES].filter((c) => !used.includes(c)) : [edit.category];
  const [category, setCategory] = useState(edit.category || options[0]);
  const [amount, setAmount] = useState(edit.amount_cents ? centsToInput(edit.amount_cents) : edit.suggest ? centsToInput(edit.suggest) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  const save = (e) => {
    e.preventDefault();
    const cents = toCents(amount);
    if (!cents) return setError(t("osmEnterAmount"));
    run(() => api.finSetBudget(category, cents));
  };
  const name = (c) => (c === "TOTAL" ? t("budOverall") : t(`finCat_${c}`));
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <form
        role="dialog"
        aria-label={isNew ? t("budAdd") : t("budEdit")}
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="onsave mx-auto w-full max-w-lg space-y-4 rounded-t-[28px] bg-os-bg px-5 pt-3"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }}
      >
        <span className="mx-auto block h-1.5 w-10 rounded-full bg-os-line" />
        <div className="flex items-center justify-between">
          <h2 className="os-display text-xl font-extrabold">{isNew ? t("budAdd") : name(category)}</h2>
          <button type="button" onClick={onClose} aria-label={t("osClose")} className={iconBtn}>
            <X className="h-5 w-5" />
          </button>
        </div>
        {isNew && (
          <label className="block">
            <span className={label}>{t("budCategory")}</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
              {options.map((c) => (
                <option key={c} value={c}>
                  {name(c)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className={label}>
            {t("budAmount")} ({currency})
          </span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            autoFocus
            placeholder={money(50000, currency, lang)}
            className={cn(field, "os-display text-xl font-bold")}
          />
        </label>
        <ErrorNote>{error}</ErrorNote>
        <button disabled={busy} className={cn(btnBrand, "w-full")}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("budSave")}
        </button>
        {!isNew && (
          <button type="button" disabled={busy} onClick={() => run(() => api.finDeleteBudget(category))} className={cn(smallBtn, "mx-auto flex text-os-danger")}>
            <Trash2 className="h-3.5 w-3.5" /> {t("budDelete")}
          </button>
        )}
      </form>
    </div>
  );
}

function BuildFromSpending({ v, onBuilt }) {
  const t = useT();
  const lang = useLang();
  const api = useApi();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const build = async (cut) => {
    setBusy(cut);
    setError(null);
    try {
      await api.finSuggestBudgets(cut, todayISO());
      onBuilt();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="rounded-3xl bg-os-deep p-4 text-white">
      <p className="flex items-center gap-2 text-[15px] font-bold">
        <Wand2 className="h-5 w-5 text-os-mint" aria-hidden="true" /> {t("budBuildTitle")}
      </p>
      <p className="mt-1 text-[13px] text-os-deep-muted">{t("budBuildBody")}</p>
      <ul className="mt-2 space-y-1 text-[13px]">
        {v.suggestions.slice(0, 6).map((s) => (
          <li key={s.category} className="flex justify-between gap-2">
            <span className="truncate text-[#e4defa]">{t(`finCat_${s.category}`)}</span>
            <span className="font-semibold">{money(s.cents, v.currency, lang)}</span>
          </li>
        ))}
      </ul>
      <ErrorNote>{error}</ErrorNote>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          [0, "budSame"],
          [10, "budLess10"],
          [20, "budLess20"],
        ].map(([cut, key]) => (
          <button
            key={cut}
            type="button"
            disabled={busy !== null}
            onClick={() => build(cut)}
            className={cn(
              "flex min-h-11 items-center justify-center rounded-2xl px-2 text-center text-[12.5px] font-bold leading-tight transition",
              cut === 10 ? "bg-white text-[#3f2aa8]" : "bg-white/12 text-white hover:bg-white/20"
            )}
          >
            {busy === cut ? <Loader2 className="h-4 w-4 animate-spin" /> : t(key)}
          </button>
        ))}
      </div>
    </section>
  );
}

export default function BudgetPage() {
  const t = useT();
  const api = useApi();
  const [month, setMonth] = useState(thisMonth());
  const [v, setV] = useState(null);
  const [error, setError] = useState(null);
  const [edit, setEdit] = useState(null); // {category?, amount_cents?, suggest?}
  const [version, setVersion] = useState(0);
  const tips = useTips(version);
  const fin = useFin();

  const load = useCallback(() => {
    api
      .finBudgets(month, todayISO())
      .then((d) => {
        setV(d);
        setError(null);
      })
      .catch((e) => setError(errorText(e)));
  }, [api, month]);
  useEffect(load, [load]);
  const changed = () => {
    setEdit(null);
    setVersion((n) => n + 1);
    load();
  };

  const current = month === thisMonth();
  const used = v ? [...v.budgets.map((b) => b.category), ...(v.overall ? ["TOTAL"] : [])] : [];

  return (
    <div className="space-y-4 pt-2">
      <header className="flex items-center gap-3">
        <Link to="/onsave/fin" aria-label={t("back")} className={iconBtn}>
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-os-brand-soft text-os-brand">
          <PieChart className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="os-display flex-1 text-2xl font-extrabold">{t("budTitle")}</h1>
        <button type="button" onClick={() => setEdit({})} aria-label={t("budAdd")} className={cn(iconBtn, "text-os-brand")}>
          <Plus className="h-5 w-5" />
        </button>
      </header>

      <MonthPicker month={month} setMonth={setMonth} />
      <ErrorNote>{error || fin.error}</ErrorNote>
      {!v && !error && <Spinner />}
      {v && (
        <>
          {!v.connected && fin.enabled && (
            <section className={cn(card, "space-y-3 p-4")}>
              <p className="text-[13px] text-os-muted">{t("budConnect")}</p>
              <ConnectButton fin={fin} className="w-full" />
            </section>
          )}
          <Donut v={v} />
          {current && v.suggestions.length > 0 && v.budgets.length < 3 && <BuildFromSpending v={v} onBuilt={changed} />}

          <section className={cn(card, "px-4 py-1")}>
            <div className="flex items-center justify-between pt-3">
              <h2 className="text-[15px] font-bold">{t("budYour")}</h2>
              <button type="button" onClick={() => setEdit({})} className="text-[13px] font-semibold text-os-brand">
                {t("budAdd")}
              </button>
            </div>
            <ul className="divide-y divide-os-line">
              {v.overall ? (
                <BudgetRow b={v.overall} currency={v.currency} overall onEdit={() => setEdit(v.overall)} />
              ) : (
                <li>
                  <button type="button" onClick={() => setEdit({ category: "TOTAL" })} className="flex w-full items-center gap-3 py-3 text-left">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-os-brand/40 text-os-brand">
                      <Target className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold">{t("budOverall")}</span>
                      <span className="block text-[13px] text-os-muted">{t("budOverallBody")}</span>
                    </span>
                  </button>
                </li>
              )}
              {v.budgets.map((b) => (
                <BudgetRow key={b.category} b={b} currency={v.currency} onEdit={() => setEdit(b)} />
              ))}
            </ul>
            {v.budgets.length === 0 && <p className="pb-3 text-[13px] text-os-muted">{t("budNone")}</p>}
          </section>

          {current && <TipsCard data={tips} />}
        </>
      )}
      {edit && v && (
        <BudgetSheet
          edit={edit}
          used={edit.amount_cents ? [] : used}
          currency={v.currency}
          onClose={() => setEdit(null)}
          onSaved={changed}
        />
      )}
    </div>
  );
}
