import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { ArrowDownLeft, ArrowUpRight, Check, Plus, X } from "lucide-react";
import { ContactsButton, SendToPeople } from "@/components/contacts";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { CURRENCIES, METHODS, todayISO } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Avatar, ErrorNote, TopBar, btnBrand, btnGhost, btnMoney, card, field, label, money } from "../ui";
import { AlertsCard, KindIcon, messageFor } from "./shared";

const NAME_KEY = "mayelai.ownerName"; // shared with the loan form
const remember = (k) => {
  try {
    return localStorage.getItem(k) || "";
  } catch {
    return "";
  }
};
const store = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

const KINDS = { request: ["owed", "borrow", "help"], send: ["lend", "gift"] };
const toCents = (a) => Math.round(parseFloat(String(a || "0").replace(",", ".")) * 100) || 0;

// People you've dealt with before, newest first, without duplicates.
function useRecent(api) {
  const [recent, setRecent] = useState([]);
  useEffect(() => {
    Promise.all([api.listRequests(), api.listLoans()])
      .then(([req, loans]) => {
        const seen = new Set();
        const out = [];
        const all = [
          ...req.mine.map((r) => ({ name: r.counterparty_name, phone: r.counterparty_phone || "", at: r.created_at })),
          ...loans.loans.map((l) => ({ name: l.counterparty_name, phone: l.counterparty_phone || "", at: l.created_at })),
        ].sort((a, b) => (a.at < b.at ? 1 : -1));
        for (const p of all) {
          const k = p.name.trim().toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ name: p.name, phone: p.phone });
        }
        setRecent(out.slice(0, 10));
      })
      .catch(() => {});
  }, [api]);
  return recent;
}

export default function MoneyFlow() {
  const [params] = useSearchParams();
  const mode = params.get("mode") === "send" ? "send" : "request";
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const { user } = useUser();
  const recent = useRecent(api);

  const [amount, setAmount] = useState(params.get("amount") || "");
  const [currency, setCurrency] = useState(CURRENCIES.includes(params.get("currency")) ? params.get("currency") : "USD");
  const [people, setPeople] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [kind, setKind] = useState(KINDS[mode][0]);
  const [split, setSplit] = useState(false);
  const [includeMe, setIncludeMe] = useState(true);
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState("");
  const [ownerName, setOwnerName] = useState(() => remember(NAME_KEY));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (!ownerName && user?.firstName) setOwnerName(user.firstName);
  }, [user, ownerName]);
  useEffect(() => setKind(KINDS[mode][0]), [mode]);

  const cents = toCents(amount);
  const canSplit = kind === "owed" && people.length > 0;
  const splitting = canSplit && split;
  const shares = people.length + (includeMe ? 1 : 0);
  const each = splitting && shares ? Math.floor(cents / shares) : cents;
  const amountText = money(cents, currency, lang);

  const has = (p) => people.some((x) => x.name.trim().toLowerCase() === p.name.trim().toLowerCase());
  const addPeople = (list) => setPeople((cur) => [...cur, ...list.filter((p) => p.name && !cur.some((x) => x.name.toLowerCase() === p.name.toLowerCase()))]);
  const addTyped = () => {
    if (!newName.trim()) return;
    addPeople([{ name: newName.trim(), phone: newPhone.trim() }]);
    setNewName("");
    setNewPhone("");
    setAdding(false);
  };

  const recentLeft = recent.filter((p) => !has(p));

  const submit = async () => {
    setError(null);
    if (!cents) return setError(t("osmEnterAmount"));
    if (!people.length) return setError(t("osmChoosePerson"));
    if (kind === "lend" && people.length > 1) return setError(t("osmOnePersonLend"));
    setBusy(true);
    try {
      store(NAME_KEY, ownerName);
      const base = { note, currency };
      if (kind === "lend") {
        const p = people[0];
        const loan = await api.createLoan({
          owner_name: ownerName,
          direction: "lent",
          counterparty_name: p.name,
          counterparty_phone: p.phone,
          amount: String(amount).replace(",", "."),
          currency,
          lent_on: todayISO(),
          due_on: due,
          note,
          reminder_language: lang === "fr" ? "fr" : "en",
          today: todayISO(),
        });
        setDone([{ ...p, ...base, kind, cents, due, token: loan.share_token, loan: true, id: loan.id }]);
      } else {
        const { requests } = await api.createRequests({
          kind,
          owner_name: ownerName,
          recipients: people.map((p) => ({ name: p.name, phone: p.phone })),
          amount: String(amount).replace(",", "."),
          currency,
          note,
          due_on: kind === "borrow" ? due : "",
          split: splitting,
          include_me: splitting && includeMe,
          method: kind === "gift" ? method : "",
          today: todayISO(),
        });
        setDone(
          requests.map((r) => ({
            name: r.counterparty_name,
            phone: r.counterparty_phone || "",
            kind,
            cents: r.amount_cents,
            currency,
            note,
            due: r.due_on,
            token: r.share_token,
            linked: r.linked,
            id: r.id,
          }))
        );
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  // ---------- after sending ----------
  if (done) {
    const linked = done.filter((d) => d.linked).map((d) => d.name);
    const single = done.length === 1 ? done[0] : null;
    return (
      <div className="flex flex-1 flex-col gap-5 pt-6">
        <div className="text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-os-money-soft">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-os-btn-money text-white">
              <Check className="h-8 w-8" strokeWidth={2.6} />
            </span>
          </div>
          <h1 className="os-display mt-4 text-[26px] font-extrabold">{t("osmLetThemKnow")}</h1>
          <p className="mx-auto mt-1 max-w-xs text-[14px] text-os-muted">{t("osmLetThemKnowBody")}</p>
        </div>
        <SendToPeople tone="onsave" people={done} message={(d) => messageFor(d, t, lang)} />
        {linked.length > 0 && <p className="text-center text-[13px] text-os-muted">{t("osmAlsoAlerted", { names: linked.join(", ") })}</p>}
        {done[0].kind !== "lend" && <AlertsCard compact />}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() =>
            navigate(single ? (single.loan ? `/onsave/money/${single.id}` : `/onsave/money/requests/${single.id}`) : "/onsave/money", { replace: true })
          }
          className={cn(btnBrand, "h-14 w-full text-base")}
        >
          {t("osmDone")}
        </button>
      </div>
    );
  }

  // ---------- the form ----------
  const kinds = KINDS[mode];
  return (
    <div className="flex flex-1 flex-col gap-5 pt-2">
      <div className="flex items-center gap-3">
        <TopBar back="/onsave/money" />
        <div className="flex flex-1 justify-end gap-1 rounded-full bg-os-line-soft p-1">
          {["request", "send"].map((m) => (
            <Link
              key={m}
              replace
              to={`/onsave/money/send?mode=${m}&amount=${encodeURIComponent(amount)}&currency=${currency}`}
              className={cn(
                "flex h-9 flex-1 items-center justify-center gap-1 rounded-full text-[13px] font-semibold transition",
                mode === m ? "bg-os-card text-os-ink shadow-sm" : "text-os-muted"
              )}
            >
              {m === "request" ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
              {t(m === "request" ? "osmRequest" : "osmSend")}
            </Link>
          ))}
        </div>
      </div>

      {/* Amount */}
      <section className="text-center">
        <label className="sr-only" htmlFor="flow-amount">
          {t("osmAmount")}
        </label>
        <div className="flex items-center justify-center gap-2">
          <input
            id="flow-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, "").slice(0, 10))}
            placeholder="0"
            className="os-display w-44 bg-transparent text-center text-[52px] font-extrabold leading-none tracking-tight outline-none placeholder:text-os-muted/40"
          />
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            aria-label="Currency"
            className="h-9 rounded-full border border-os-line bg-os-card px-2 text-sm font-bold"
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        {splitting && cents > 0 && (
          <p className="mt-2 text-sm font-semibold text-os-money">{t("osmEach", { amount: money(each, currency, lang) })}</p>
        )}
      </section>

      {/* People */}
      <section className={cn(card, "space-y-3 p-4")}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-bold">{t(mode === "request" ? "osmFrom" : "osmTo")}</h2>
          <div className="flex gap-1.5">
            <ContactsButton
              multiple={kind !== "lend"}
              onPick={addPeople}
              className="h-9 rounded-full border border-os-line bg-os-card px-3 text-xs font-semibold"
            />
            <button type="button" onClick={() => setAdding((a) => !a)} className="inline-flex h-9 items-center gap-1 rounded-full border border-os-line bg-os-card px-3 text-xs font-semibold">
              <Plus className="h-4 w-4" /> {t("osmAddPerson")}
            </button>
          </div>
        </div>
        {people.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {people.map((p) => (
              <li key={p.name} className="flex items-center gap-2 rounded-full bg-os-brand-soft py-1 pl-1 pr-2 text-sm font-semibold text-os-brand-ink">
                <Avatar name={p.name} size={26} />
                <span className="max-w-[9rem] truncate">{p.name}</span>
                <button type="button" aria-label={`${t("osRemove")} ${p.name}`} onClick={() => setPeople((cur) => cur.filter((x) => x !== p))}>
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {adding && (
          <div className="space-y-2 rounded-2xl bg-os-bg p-3">
            <input id="flow-name" autoFocus maxLength={80} placeholder={t("osmPersonName")} value={newName} onChange={(e) => setNewName(e.target.value)} className={field} />
            <input
              id="flow-phone"
              type="tel"
              inputMode="tel"
              maxLength={24}
              placeholder={t("osmPersonPhone")}
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTyped())}
              className={field}
            />
            <button type="button" disabled={!newName.trim()} onClick={addTyped} className={cn(btnGhost, "w-full")}>
              <Plus className="h-4 w-4" /> {t("osmAddPerson")}
            </button>
          </div>
        )}
        {recentLeft.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-os-muted">{t("osmRecent")}</p>
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
              {recentLeft.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => addPeople([p])}
                  className="flex w-16 shrink-0 flex-col items-center gap-1 rounded-2xl py-1 text-[11px] font-medium hover:bg-os-line-soft"
                >
                  <Avatar name={p.name} size={40} />
                  <span className="w-full truncate text-center">{p.name.split(" ")[0]}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* What it is */}
      <section className="space-y-2.5">
        <h2 className="text-[15px] font-bold">{t("osmWhat")}</h2>
        <div className={cn("grid gap-2", kinds.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                "flex flex-col items-start gap-2 rounded-2xl border-2 p-3 text-left transition",
                kind === k ? "border-os-brand bg-os-brand-soft" : "border-os-line bg-os-card hover:border-os-brand/40"
              )}
            >
              <KindIcon kind={k === "lend" ? "lent" : k} size={32} />
              <span>
                <span className="block text-sm font-bold">{t(`osmKind_${k}`)}</span>
                <span className="block text-[11px] leading-snug text-os-muted">{t(`osmKindBody_${k}`)}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {canSplit && (
        <section className={cn(card, "space-y-2 p-4")}>
          <label className="flex items-center justify-between gap-3 text-sm font-semibold">
            {t("osmSplit", { amount: amountText })}
            <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} className="h-5 w-5 accent-[#5a3fd4]" />
          </label>
          {split && (
            <label className="flex items-center justify-between gap-3 text-[13px] text-os-muted">
              {t("osmIncludeMe")}
              <input type="checkbox" checked={includeMe} onChange={(e) => setIncludeMe(e.target.checked)} className="h-5 w-5 accent-[#5a3fd4]" />
            </label>
          )}
        </section>
      )}

      {(kind === "borrow" || kind === "lend") && (
        <label className="block">
          <span className={label}>{t("osmPayBackBy")}</span>
          <input type="date" min={todayISO()} value={due} onChange={(e) => setDue(e.target.value)} className={field} />
        </label>
      )}
      {kind === "gift" && (
        <label className="block">
          <span className={label}>{t("osmHowSent")}</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={field}>
            <option value="">—</option>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className={label}>{t("osmNote")}</span>
        <input id="flow-note" maxLength={300} placeholder={t("osmNotePh")} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
      </label>
      <label className="block">
        <span className={label}>{t("osmYourName")}</span>
        <input id="flow-owner" maxLength={80} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className={field} />
      </label>

      <ErrorNote>{error}</ErrorNote>
      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className={cn(mode === "request" ? btnBrand : btnMoney, "h-14 w-full text-base")}
      >
        {mode === "request" ? <ArrowDownLeft className="h-5 w-5" /> : <ArrowUpRight className="h-5 w-5" />}
        {t(mode === "request" ? "osmRequestTitle" : "osmSendTitle", { amount: amountText })}
      </button>
    </div>
  );
}
