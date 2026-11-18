import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, HandCoins, Loader2, Plus, Sparkles } from "lucide-react";
import Heading from "@/components/heading";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { dueLabel, formatDate, formatMoney, todayISO } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Card, LangSwitch, ResponseBadge, StatusBadge } from "./parts";

function Totals({ loans }) {
  const t = useT();
  const lang = useLang();
  const totals = useMemo(() => {
    const out = {};
    for (const l of loans) {
      if (l.status !== "open") continue;
      const k = l.currency;
      out[k] ??= { owed: 0, owe: 0, late: 0 };
      if (l.direction === "lent") out[k].owed += l.outstanding_cents;
      else out[k].owe += l.outstanding_cents;
      if (l.due_on && l.due_on < todayISO()) out[k].late += 1;
    }
    return Object.entries(out);
  }, [loans]);
  if (totals.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ArrowUpRight className="h-4 w-4 text-emerald-600" /> {t("owedToYou")}
        </p>
        <div className="mt-1 space-y-0.5">
          {totals.map(([cur, v]) => (
            <p key={cur} className="text-2xl font-bold">
              {formatMoney(v.owed, cur, lang)}
            </p>
          ))}
        </div>
      </Card>
      <Card>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ArrowDownLeft className="h-4 w-4 text-rose-600" /> {t("youOwe")}
        </p>
        <div className="mt-1 space-y-0.5">
          {totals.map(([cur, v]) => (
            <p key={cur} className="text-2xl font-bold">
              {formatMoney(v.owe, cur, lang)}
            </p>
          ))}
        </div>
      </Card>
    </div>
  );
}

function LoanRow({ loan }) {
  const t = useT();
  const lang = useLang();
  const due = dueLabel(loan, t);
  const open = loan.status === "open";
  return (
    <Link
      to={`/onsave/money/${loan.id}`}
      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/40"
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
          loan.direction === "lent" ? "bg-emerald-500/15 text-emerald-700" : "bg-rose-500/15 text-rose-700"
        )}
      >
        {loan.direction === "lent" ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownLeft className="h-5 w-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          <span className="truncate">{loan.counterparty_name}</span>
          {open ? <ResponseBadge response={loan.response} /> : <StatusBadge status={loan.status} />}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {loan.direction === "lent" ? t("lentTo") : t("borrowedFrom")} · {formatDate(loan.lent_on, lang)}
          {open && (
            <>
              {" · "}
              <span className={cn(due.late && "font-semibold text-rose-600", due.soon && "font-medium text-amber-700")}>
                {due.text}
              </span>
            </>
          )}
          {loan.last_reminded_at && open && <> · {t("remindedOn", { date: formatDate(loan.last_reminded_at, lang) })}</>}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-bold">{formatMoney(open ? loan.outstanding_cents : loan.amount_cents, loan.currency, lang)}</p>
        {open && loan.paid_cents > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("of")} {formatMoney(loan.amount_cents, loan.currency, lang)}
          </p>
        )}
      </div>
    </Link>
  );
}

export default function MoneyPage() {
  const api = useApi();
  const t = useT();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("open");
  const [sentence, setSentence] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.listLoans().then(setData).catch((e) => setError(errorText(e)));
  }, [api]);
  useEffect(load, [load]);

  const loans = data?.loans ?? [];
  const shown = loans.filter((l) => (tab === "open" ? l.status === "open" : l.status !== "open"));
  const openCount = loans.filter((l) => l.status === "open").length;
  const limit = data?.open_limit ?? 0;
  const atLimit = limit > 0 && openCount >= limit;

  const understand = async (e) => {
    e.preventDefault();
    if (!sentence.trim()) return;
    setParsing(true);
    setParseError(null);
    try {
      const draft = await api.parseLoan(sentence.trim(), todayISO());
      navigate("/onsave/money/new", { state: { draft } });
    } catch (err) {
      setParseError(errorText(err));
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between gap-2 pr-4 lg:pr-8">
        <Heading
          title={t("money")}
          description={t("moneyTagline")}
          icon={HandCoins}
          iconColor="text-emerald-600"
          bgColor="bg-emerald-500/10"
        />
        <LangSwitch className="shrink-0" />
      </div>

      <div className="mx-auto w-full max-w-3xl space-y-5 px-4 pb-12 lg:px-8">
        {/* Quick add with the assistant */}
        <Card>
          <form onSubmit={understand} className="space-y-3">
            <label htmlFor="sentence" className="flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-primary" /> {t("quickAdd")}
            </label>
            <textarea
              id="sentence"
              rows={2}
              value={sentence}
              maxLength={300}
              onChange={(e) => setSentence(e.target.value)}
              placeholder={t("quickAddPlaceholder")}
              className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-primary/30 md:text-sm"
            />
            {parseError && <p className="text-sm text-rose-600">{parseError}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={parsing || !sentence.trim() || atLimit}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {t("understand")}
              </button>
              <Link
                to="/onsave/money/new"
                aria-disabled={atLimit}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent",
                  atLimit && "pointer-events-none opacity-50"
                )}
              >
                <Plus className="h-4 w-4" /> {t("addManually")}
              </Link>
            </div>
            {limit > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("freeUsage", { n: Math.min(openCount, limit), max: limit })}{" "}
                <Link to="/settings" className="font-medium text-primary hover:underline">
                  {t("upgrade")}
                </Link>
              </p>
            )}
          </form>
        </Card>

        {error ? (
          <Card>
            <p className="text-sm text-rose-600">{error}</p>
            <button onClick={load} className="mt-2 text-sm font-medium text-primary hover:underline">
              ↻
            </button>
          </Card>
        ) : !data ? (
          <div className="flex justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            <Totals loans={loans} />

            <div role="tablist" className="flex gap-6 border-b border-border">
              {["open", "closed"].map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={cn(
                    "-mb-px border-b-2 pb-2 text-sm font-semibold transition",
                    tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t(k)} ({loans.filter((l) => (k === "open" ? l.status === "open" : l.status !== "open")).length})
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <div className="py-10 text-center">
                <HandCoins className="mx-auto h-10 w-10 text-muted-foreground/50" />
                <p className="mt-2 font-semibold">{t("nothingYet")}</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{t("nothingYetBody")}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {shown.map((l) => (
                  <LoanRow key={l.id} loan={l} />
                ))}
              </div>
            )}
            <p className="text-center text-xs text-muted-foreground">{t("noMoneyHandled")}</p>
          </>
        )}
      </div>
    </div>
  );
}
