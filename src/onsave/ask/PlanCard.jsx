import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronRight, Loader2, PiggyBank } from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { todayISO } from "@/lib/money";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "../fin/shared";
import { ErrorNote, money } from "../ui";

// The budget plan Mayele proposes in a "My Finances" reply (see lib/plan.js),
// with one tap to create the budgets.
export function PlanCard({ plan }) {
  const t = useT();
  const lang = useLang();
  const api = useApi();
  const [current, setCurrent] = useState(null); // category -> cents, and currency
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let off = false;
    api
      .finBudgets(undefined, todayISO())
      .then((v) => {
        if (off) return;
        const by = {};
        for (const b of v.budgets || []) by[b.category] = b.amount_cents;
        if (v.overall) by.TOTAL = v.overall.amount_cents;
        const spent = { TOTAL: v.spent_cents || 0 };
        for (const c of v.by_category || []) spent[c.category] = c.cents;
        setCurrent({ by, spent, currency: v.currency || "USD" });
      })
      .catch(() => !off && setCurrent({ by: {}, spent: {}, currency: "USD" }));
    return () => {
      off = true;
    };
  }, [api]);

  const cur = current?.currency || "USD";
  const done = current && plan.budgets.every((b) => current.by[b.category] === b.amount_cents);
  const total = plan.budgets.filter((b) => b.category !== "TOTAL").reduce((n, b) => n + b.amount_cents, 0);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.finApplyPlan(plan.budgets);
      setCurrent((c) => ({ ...c, by: { ...c?.by, ...Object.fromEntries(plan.budgets.map((b) => [b.category, b.amount_cents])) } }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-os-line bg-os-bg">
      <div className="flex items-center gap-2.5 border-b border-os-line px-3.5 py-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-os-money-soft text-os-money">
          <PiggyBank className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold">{plan.title || t("planTitle")}</span>
          <span className="block text-[12px] text-os-muted">{t("planSub")}</span>
        </span>
      </div>
      <ul className="divide-y divide-os-line">
        {plan.budgets.map((b) => {
          const was = current?.by[b.category];
          const spent = current?.spent?.[b.category] || 0;
          return (
            <li key={b.category} className="flex items-center gap-3 px-3.5 py-2">
              <CategoryIcon category={b.category} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{b.category === "TOTAL" ? t("planTotal") : t(`finCat_${b.category}`)}</span>
                {spent > 0 && (
                  <span className={cn("block text-[11.5px]", spent > b.amount_cents ? "font-semibold text-os-danger" : "text-os-muted")}>
                    {t(spent > b.amount_cents ? "planOver" : "planSpent", { amount: money(spent, cur, lang) })}
                  </span>
                )}
              </span>
              <span className="text-right">
                <span className="block text-[14px] font-semibold">{money(b.amount_cents, cur, lang)}</span>
                {was != null && was !== b.amount_cents && (
                  <span className="block text-[11px] text-os-muted line-through">{money(was, cur, lang)}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {!plan.budgets.some((b) => b.category === "TOTAL") && plan.budgets.length > 1 && (
        <p className="border-t border-os-line px-3.5 py-2 text-right text-[12.5px] text-os-muted">
          {t("planSum", { amount: money(total, cur, lang) })}
        </p>
      )}
      <div className="border-t border-os-line p-2.5">
        {done ? (
          <Link
            to="/onsave/budget"
            className="flex h-10 items-center justify-center gap-2 rounded-full bg-os-money-soft text-[14px] font-semibold text-os-money"
          >
            <Check className="h-4 w-4" /> {t("planDone")} <ChevronRight className="h-4 w-4" />
          </Link>
        ) : (
          <button
            type="button"
            onClick={create}
            disabled={busy || !current}
            className={cn("flex h-10 w-full items-center justify-center gap-2 rounded-full bg-os-btn text-[14px] font-semibold text-white transition disabled:opacity-60")}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {Object.keys(current?.by || {}).some((c) => plan.budgets.some((b) => b.category === c)) ? t("planUpdate") : t("planCreate")}
          </button>
        )}
        <ErrorNote>{error}</ErrorNote>
      </div>
    </div>
  );
}
