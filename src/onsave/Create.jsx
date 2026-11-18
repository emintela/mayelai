import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { ChevronLeft, Minus, Plus } from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { CURRENCIES } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ErrorNote, btnBrand, card, field, iconBtn, label, money } from "./ui";

const read = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const SYMBOL = { USD: "$", EUR: "€", CAD: "CA$" };
const FREQS = [
  ["weekly", "osWeekly"],
  ["biweekly", "osBiweekly"],
  ["monthly", "osMonthly"],
];

// Amount typed by the person ("200", "200,50") → cents, or null.
const toCents = (s) => {
  const n = Number(String(s).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

export default function Create() {
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const { user } = useUser();
  const [step, setStep] = useState(1);
  const [members, setMembers] = useState(6);
  const [form, setForm] = useState(() => ({
    name: "",
    rules: "",
    amount: "",
    currency: read("mayelai.currency") || "USD",
    frequency: "monthly",
    owner_name: read("mayelai.ownerName") || user?.fullName || user?.firstName || "",
    include_me: true,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [upgrade, setUpgrade] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const cents = toCents(form.amount);
  const span =
    form.frequency === "weekly"
      ? t("osSpanWeeks", { n: members })
      : form.frequency === "biweekly"
        ? t("osSpanWeeks", { n: members * 2 })
        : t("osSpanMonths", { n: members });

  const next = (e) => {
    e.preventDefault();
    setError(null);
    if (step < 3) return setStep(step + 1);
    create();
  };
  const create = async () => {
    setBusy(true);
    try {
      try {
        localStorage.setItem("mayelai.currency", form.currency);
        if (form.owner_name) localStorage.setItem("mayelai.ownerName", form.owner_name);
      } catch {
        /* ignore */
      }
      const g = await api.createGroup(form);
      navigate(`/onsave/groups/${g.id}?created=1`, { replace: true });
    } catch (err) {
      setError(errorText(err));
      setUpgrade(!!err?.response?.data?.upgrade);
      setBusy(false);
    }
  };

  const seg = (on) =>
    cn("h-10 rounded-xl text-sm font-semibold transition", on ? "bg-os-card text-os-ink shadow-sm" : "text-os-muted hover:text-os-ink");
  const chip = (on) =>
    cn(
      "min-h-12 rounded-2xl border-2 px-2 text-sm font-semibold transition",
      on ? "border-os-brand bg-os-brand-soft text-os-brand-ink" : "border-os-line bg-os-card text-os-ink hover:border-os-brand/40"
    );

  return (
    <form onSubmit={next} className="flex flex-1 flex-col gap-5 pt-2">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (step > 1 ? setStep(step - 1) : navigate(-1))}
          aria-label={t("back")}
          className={iconBtn}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-1 gap-1.5" role="progressbar" aria-label={t("osStepOf", { n: step })} aria-valuemin={1} aria-valuemax={3} aria-valuenow={step}>
          {[1, 2, 3].map((n) => (
            <span key={n} className={cn("h-1.5 flex-1 rounded-full transition", n <= step ? "bg-os-brand" : "bg-os-line")} />
          ))}
        </div>
      </header>

      {step === 1 && (
        <>
          <div>
            <h1 className="os-display text-[26px] font-extrabold leading-tight">{t("osStep1Title")}</h1>
            <p className="mt-1.5 text-sm text-os-muted">{t("osStep1Body")}</p>
          </div>
          <label className="block">
            <span className={label}>{t("osGroupName")}</span>
            <input id="group-name" autoFocus required maxLength={120} placeholder={t("osGroupNamePh")} value={form.name} onChange={(e) => set("name", e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className={label}>{t("osRulesLabel")}</span>
            <textarea
              rows={4}
              maxLength={1000}
              placeholder={t("osRulesPh")}
              value={form.rules}
              onChange={(e) => set("rules", e.target.value)}
              className={cn(field, "h-auto resize-none py-3")}
            />
          </label>
        </>
      )}

      {step === 2 && (
        <>
          <div>
            <h1 className="os-display text-[26px] font-extrabold leading-tight">{t("osStep2Title")}</h1>
            <p className="mt-1.5 text-sm text-os-muted">{t("osStep2Body")}</p>
          </div>
          <section className={cn(card, "space-y-3.5 p-4")}>
            <label htmlFor="amount" className="text-[13px] font-semibold text-os-muted">
              {t("osAmountPer")}
            </label>
            <div className="flex items-baseline gap-2">
              <span className="os-display text-3xl font-bold text-os-muted">{SYMBOL[form.currency]}</span>
              <input
                id="amount"
                autoFocus
                required
                inputMode="decimal"
                placeholder="200"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
                className="os-display w-full min-w-0 border-0 bg-transparent p-0 text-[44px] font-extrabold tracking-tight text-os-ink outline-none placeholder:text-os-line"
              />
            </div>
            <div role="group" aria-label={t("currency")} className="grid grid-cols-3 gap-1 rounded-2xl bg-os-line-soft p-1">
              {CURRENCIES.map((c) => (
                <button key={c} type="button" aria-pressed={form.currency === c} onClick={() => set("currency", c)} className={seg(form.currency === c)}>
                  {c}
                </button>
              ))}
            </div>
          </section>
          <section className="space-y-2.5">
            <h2 className="text-[13px] font-semibold text-os-muted">{t("osRoundsHappen")}</h2>
            <div role="group" aria-label={t("osRoundsHappen")} className="grid grid-cols-3 gap-2">
              {FREQS.map(([f, key]) => (
                <button key={f} type="button" aria-pressed={form.frequency === f} onClick={() => set("frequency", f)} className={chip(form.frequency === f)}>
                  {t(key)}
                </button>
              ))}
            </div>
          </section>
          <section className={cn(card, "flex items-center justify-between rounded-2xl px-4 py-3")}>
            <div>
              <p className="text-[15px] font-semibold">{t("osExpected")}</p>
              <p className="text-xs text-os-muted">{t("osExpectedBody")}</p>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setMembers((n) => Math.max(2, n - 1))} aria-label={t("osFewer")} className={iconBtn}>
                <Minus className="h-5 w-5" />
              </button>
              <span className="os-display min-w-6 text-center text-xl font-bold" aria-live="polite">
                {members}
              </span>
              <button type="button" onClick={() => setMembers((n) => Math.min(50, n + 1))} aria-label={t("osMoreMembers")} className={cn(iconBtn, "border-0 bg-os-btn text-white hover:bg-[#4b33bd]")}>
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </section>
          {cents && (
            <section className="space-y-1.5 rounded-3xl bg-os-deep p-4 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-os-deep-muted">{t("osEachRound")}</p>
              <p className="text-[15px] leading-relaxed">
                {t("osPotSummary", { pot: "\u0000", span })
                  .split("\u0000")
                  .flatMap((part, i) =>
                    i === 0 ? [part] : [<strong key={i} className="os-display text-xl text-os-mint">{money(cents * members, form.currency, lang)}</strong>, part]
                  )}
              </p>
            </section>
          )}
        </>
      )}

      {step === 3 && (
        <>
          <div>
            <h1 className="os-display text-[26px] font-extrabold leading-tight">{t("osStep3Title")}</h1>
            <p className="mt-1.5 text-sm text-os-muted">{t("osStep3Body")}</p>
          </div>
          <label className="block">
            <span className={label}>{t("osYourName")}</span>
            <input autoFocus required maxLength={80} value={form.owner_name} onChange={(e) => set("owner_name", e.target.value)} className={field} />
          </label>
          <label className={cn(card, "flex cursor-pointer items-start gap-3 rounded-2xl p-4")}>
            <input type="checkbox" checked={form.include_me} onChange={(e) => set("include_me", e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#5a3fd4]" />
            <span>
              <span className="block text-[15px] font-semibold">{t("osIncludeMe")}</span>
              <span className="block text-[13px] text-os-muted">{t("osIncludeMeBody")}</span>
            </span>
          </label>
        </>
      )}

      <div className="flex-1" />
      {error && (
        <ErrorNote>
          {error}
          {upgrade && (
            <>
              {" "}
              <Link to="/settings" className="font-semibold underline">
                {t("upgrade")}
              </Link>
            </>
          )}
        </ErrorNote>
      )}
      <button type="submit" disabled={busy || (step === 2 && !cents)} className={cn(btnBrand, "h-14 w-full text-base")}>
        {step < 3 ? t("osContinue") : t("osCreate")}
      </button>
    </form>
  );
}
