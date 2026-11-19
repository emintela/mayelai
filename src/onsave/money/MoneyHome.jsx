import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, Delete, Loader2, Sparkles } from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { CURRENCIES, dueLabel, todayISO } from "@/lib/money";
import { cn } from "@/lib/utils";
import { MoneySwitch } from "../FamilyMoney";
import { Avatar, Chip, ErrorNote, LinkCard, Spinner, card, field, money } from "../ui";
import { ForMeRow, KindIcon, MineRow, balances, forMeNeedsYou, ownerReceives } from "./shared";

const CUR_KEY = "onsave.currency";
const readCurrency = () => {
  try {
    const c = localStorage.getItem(CUR_KEY);
    return CURRENCIES.includes(c) ? c : "USD";
  } catch {
    return "USD";
  }
};

// Adds one key to the typed amount: digits, one dot, at most 2 decimals and 7 digits before it.
function press(amount, key) {
  if (key === "back") return amount.slice(0, -1);
  if (key === ".") return amount.includes(".") ? amount : (amount || "0") + ".";
  const [whole, frac] = amount.split(".");
  if (frac !== undefined) return frac.length >= 2 ? amount : amount + key;
  if (whole === "0") return key;
  return whole.length >= 7 ? amount : amount + key;
}

const toCents = (amount) => Math.round(parseFloat(amount || "0") * 100) || 0;

function Pad() {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(readCurrency);
  const cents = toCents(amount);

  // Typing on a keyboard works too.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.("input, textarea, select")) return;
      if (/^[0-9]$/.test(e.key) || e.key === "." || e.key === ",") setAmount((a) => press(a, e.key === "," ? "." : e.key));
      else if (e.key === "Backspace") setAmount((a) => press(a, "back"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pickCurrency = (c) => {
    setCurrency(c);
    try {
      localStorage.setItem(CUR_KEY, c);
    } catch {
      /* ignore */
    }
  };
  const go = (mode) => navigate(`/onsave/money/send?mode=${mode}&amount=${encodeURIComponent(amount)}&currency=${currency}`);

  // Show what was typed ("12." stays visible while typing) with the currency symbol.
  const shown = amount ? money(toCents(amount.split(".")[0] || "0"), currency, lang) : money(0, currency, lang);
  const typedFrac = amount.includes(".") ? (lang === "fr" ? "," : ".") + amount.split(".")[1] : "";
  const display = lang === "fr" ? shown.replace(/(\s?[^\d\s]+.*)$/, `${typedFrac}$1`) : shown + typedFrac;

  return (
    <section className="relative overflow-hidden rounded-[28px] bg-os-deep p-5 pb-4 text-white">
      <div className="flex justify-center gap-1.5" role="group" aria-label="Currency">
        {CURRENCIES.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={currency === c}
            onClick={() => pickCurrency(c)}
            className={cn("h-8 rounded-full px-3 text-xs font-bold transition", currency === c ? "bg-white text-[#241a4f]" : "text-os-deep-muted hover:text-white")}
          >
            {c}
          </button>
        ))}
      </div>
      <p aria-live="polite" className={cn("os-display mt-4 text-center font-extrabold leading-none tracking-tight", display.length > 9 ? "text-[44px]" : "text-[60px]", !cents && "text-white/50")}>
        {display}
      </p>
      <p className="mt-2 h-4 text-center text-xs text-os-deep-muted">{cents ? "" : t("osmEnterAmount")}</p>
      <div className="mt-3 grid grid-cols-3 gap-1">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"].map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setAmount((a) => press(a, k))}
            aria-label={k === "back" ? "Delete" : k}
            className="flex h-14 items-center justify-center rounded-2xl text-2xl font-semibold transition hover:bg-white/10 active:bg-white/15"
          >
            {k === "back" ? <Delete className="h-6 w-6" /> : k === "." ? (lang === "fr" ? "," : ".") : k}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          disabled={!cents}
          onClick={() => go("request")}
          className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-white text-base font-bold text-[#241a4f] transition active:scale-[0.98] disabled:opacity-40"
        >
          <ArrowDownLeft className="h-5 w-5" /> {t("osmRequest")}
        </button>
        <button
          type="button"
          disabled={!cents}
          onClick={() => go("send")}
          className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-os-mint text-base font-bold text-[#0b3b2a] transition active:scale-[0.98] disabled:opacity-40"
        >
          <ArrowUpRight className="h-5 w-5" /> {t("osmSend")}
        </button>
      </div>
    </section>
  );
}

function LoanRow({ loan }) {
  const t = useT();
  const lang = useLang();
  const open = loan.status === "open";
  const due = dueLabel(loan, t);
  const closedKey = { paid: "statusPaid", forgiven: "statusForgiven", cancelled: "statusCancelled" }[loan.status];
  return (
    <LinkCard to={`/onsave/money/${loan.id}`} className="flex items-center gap-3 rounded-2xl px-3.5 py-3">
      <KindIcon kind={loan.direction} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{loan.counterparty_name}</span>
        <span className={cn("block truncate text-[13px] text-os-muted", open && due.late && "font-semibold text-os-danger")}>
          {loan.direction === "lent" ? t("lentTo") : t("borrowedFrom")}
          {open && ` · ${due.text}`}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="os-display text-[15px] font-bold">{money(open ? loan.outstanding_cents : loan.amount_cents, loan.currency, lang)}</span>
        {!open && closedKey && <Chip tone={loan.status === "paid" ? "money" : "muted"}>{t(closedKey)}</Chip>}
      </span>
    </LinkCard>
  );
}

// The assistant turns a sentence into a loan form.
function Describe() {
  const t = useT();
  const api = useApi();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const draft = await api.parseLoan(text.trim(), todayISO());
      navigate("/onsave/money/new", { state: { draft } });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className={cn(card, "group p-4")}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
        <Sparkles className="h-4 w-4 text-os-brand" /> {t("osmDescribe")}
      </summary>
      <form onSubmit={submit} className="mt-3 space-y-2">
        <textarea
          rows={2}
          maxLength={300}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("quickAddPlaceholder")}
          className={cn(field, "h-auto resize-none py-3")}
        />
        <ErrorNote>{error}</ErrorNote>
        <button disabled={busy || !text.trim()} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-os-btn px-4 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {t("understand")}
        </button>
      </form>
    </details>
  );
}

const Section = ({ title, children }) => (
  <section className="space-y-2.5">
    <h2 className="text-[15px] font-bold">{title}</h2>
    {children}
  </section>
);

export default function MoneyHome() {
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [more, setMore] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.listRequests(), api.listLoans()])
      .then(([req, loans]) => setData({ mine: req.mine, forMe: req.for_me, loans: loans.loans }))
      .catch((e) => setError(errorText(e)));
  }, [api]);
  useEffect(load, [load]);

  const mine = data?.mine ?? [];
  const forMe = data?.forMe ?? [];
  const loans = data?.loans ?? [];
  const ownerTurn = (r) => r.status === "countered" || (r.status === "sent" && ownerReceives(r));
  const open = (r) => ["pending", "countered", "accepted", "sent"].includes(r.status);
  const needs = [...forMe.filter(forMeNeedsYou).map((r) => ({ r, forMe: true })), ...mine.filter(ownerTurn).map((r) => ({ r }))];
  const waiting = mine.filter((r) => open(r) && !ownerTurn(r));
  const openLoans = loans.filter((l) => l.status === "open");
  const people = data ? balances(loans, mine, forMe) : [];
  const history = [
    ...mine.filter((r) => !open(r)).map((r) => ({ at: r.updated_at, el: <MineRow key={r.id} r={r} /> })),
    ...forMe.filter((r) => !forMeNeedsYou(r)).map((r) => ({ at: r.updated_at, el: <ForMeRow key={r.token} r={r} /> })),
    ...loans.filter((l) => l.status !== "open").map((l) => ({ at: l.updated_at, el: <LoanRow key={l.id} loan={l} /> })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <div className="space-y-5 pt-2">
      <MoneySwitch />
      <Pad />
      <ErrorNote>{error}</ErrorNote>
      {!data && !error && <Spinner />}
      {data && (
        <>
          {needs.length > 0 && (
            <Section title={t("osmNeedsAnswer")}>
              {needs.map(({ r, forMe }) => (forMe ? <ForMeRow key={r.token} r={r} /> : <MineRow key={r.id} r={r} />))}
            </Section>
          )}
          {waiting.length > 0 && (
            <Section title={t("osmWaiting")}>
              {waiting.map((r) => (
                <MineRow key={r.id} r={r} />
              ))}
            </Section>
          )}
          {people.length > 0 && (
            <Section title={t("osmPeople")}>
              <ul className={cn(card, "divide-y divide-os-line-soft overflow-hidden")}>
                {people.slice(0, 8).map((p) => (
                  <li key={p.name} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={p.name} size={34} />
                    <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{p.name}</span>
                    <span className="shrink-0 text-right text-[13px]">
                      {p.totals.map(([cur, v]) => (
                        <span key={cur} className={cn("block font-semibold", v > 0 ? "text-os-money" : "text-os-warn")}>
                          {t(v > 0 ? "osmOwesYou" : "osmYouOwe", { amount: money(Math.abs(v), cur, lang) })}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {openLoans.length > 0 && (
            <Section title={t("osmLoans")}>
              {openLoans.map((l) => (
                <LoanRow key={l.id} loan={l} />
              ))}
            </Section>
          )}
          <Describe />
          {history.length > 0 && (
            <Section title={t("osmHistory")}>
              {(more ? history : history.slice(0, 6)).map((h) => h.el)}
              {history.length > 6 && !more && (
                <button type="button" onClick={() => setMore(true)} className="w-full py-2 text-sm font-semibold text-os-brand">
                  {t("osmMore")}
                </button>
              )}
            </Section>
          )}
          {!needs.length && !waiting.length && !openLoans.length && !history.length && (
            <p className="py-4 text-center text-sm text-os-muted">{t("osmNothing")}</p>
          )}
          <p className="px-2 text-center text-xs leading-relaxed text-os-muted">{t("osmNoMoneyMoves")}</p>
        </>
      )}
    </div>
  );
}

