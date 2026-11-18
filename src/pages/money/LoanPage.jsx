import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, BellRing, Link2, Loader2, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { METHODS, centsToInput, dueLabel, formatDate, formatMoney, shareLink, todayISO } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge, Card, LangSwitch, ResponseBadge, SendButtons, StatusBadge, inputCls, labelCls } from "./parts";

function ShareCard({ loan, onRotate }) {
  const t = useT();
  const lang = useLang();
  const link = shareLink(loan.share_token);
  const text = t(loan.direction === "lent" ? "shareMessage" : "shareMessageBorrowed", {
    name: loan.counterparty_name.split(" ")[0],
    amount: formatMoney(loan.amount_cents, loan.currency, lang),
    link,
  });
  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 font-semibold">
        <Link2 className="h-4 w-4 text-primary" /> {t("shareTitle", { name: loan.counterparty_name })}
      </h2>
      <p className="text-sm text-muted-foreground">{t("shareBody", { name: loan.counterparty_name })}</p>
      <p className="rounded-xl bg-muted p-3 text-sm">{text}</p>
      <div className="flex flex-wrap items-center gap-2">
        <SendButtons phone={loan.counterparty_phone} text={text} />
        <button
          onClick={onRotate}
          className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" /> {t("newLink")}
        </button>
      </div>
    </Card>
  );
}

function ReminderCard({ loan, onChange }) {
  const api = useApi();
  const t = useT();
  const [language, setLanguage] = useState(loan.reminder_language === "en" ? "en" : "fr");
  const [tone, setTone] = useState("gentle");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const link = shareLink(loan.share_token);
  const full = message ? `${message}\n${link}` : "";

  const write = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.draftReminder(loan.id, { language, tone, today: todayISO() });
      setMessage(r.message);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const sent = async (channel) => {
    try {
      onChange(await api.logReminder(loan.id, { channel, language, message: full }));
    } catch {
      /* logging is best effort */
    }
  };

  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 font-semibold">
        <BellRing className="h-4 w-4 text-primary" /> {t("reminder")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("reminderBody")}</p>
      <div className="flex flex-wrap gap-2">
        <select value={language} onChange={(e) => setLanguage(e.target.value)} className={cn(inputCls, "w-auto")} aria-label={t("reminderLanguage")}>
          <option value="fr">Français</option>
          <option value="en">English</option>
          <option value="ln" disabled>{t("lingalaSoon")}</option>
        </select>
        <select value={tone} onChange={(e) => setTone(e.target.value)} className={cn(inputCls, "w-auto")} aria-label={t("tone")}>
          <option value="gentle">{t("gentle")}</option>
          <option value="firm">{t("firm")}</option>
        </select>
        <button
          onClick={write}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? t("writing") : t("writeWithAi")}
        </button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {message && (
        <>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={900}
            className={cn(inputCls, "resize-y")}
          />
          <SendButtons phone={loan.counterparty_phone} text={full} onSent={sent} />
        </>
      )}
      {loan.reminders?.length > 0 && <ReminderHistory reminders={loan.reminders} />}
    </Card>
  );
}

function ReminderHistory({ reminders }) {
  const t = useT();
  const lang = useLang();
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        {t("reminderHistory")} ({reminders.length})
      </summary>
      <ul className="mt-2 space-y-2">
        {reminders.map((r) => (
          <li key={r.id} className="rounded-xl bg-muted p-2.5 text-xs">
            <span className="font-medium">{formatDate(r.created_at, lang)} · {r.channel}</span>
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{r.message}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}

function PaymentCard({ loan, onChange }) {
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const open = loan.status === "open";
  const [form, setForm] = useState({ amount: centsToInput(loan.outstanding_cents), paid_on: todayISO(), method: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setForm((f) => ({ ...f, amount: centsToInput(loan.outstanding_cents) }));
  }, [loan.outstanding_cents]);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onChange(await api.addPayment(loan.id, { ...form, today: todayISO() }));
      setForm((f) => ({ ...f, note: "" }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (pid) => {
    try {
      onChange(await api.deletePayment(loan.id, pid));
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">{t("payments")}</h2>
      {loan.payments?.length ? (
        <ul className="divide-y divide-border">
          {loan.payments.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="font-semibold">{formatMoney(p.amount_cents, loan.currency, lang)}</span>
              <span className="text-muted-foreground">
                {formatDate(p.paid_on, lang)}
                {p.method && ` · ${p.method}`}
                {p.note && ` · ${p.note}`}
              </span>
              {loan.status !== "forgiven" && loan.status !== "cancelled" && (
                <button
                  onClick={() => remove(p.id)}
                  aria-label={t("remove")}
                  className="ml-auto rounded p-1 text-muted-foreground hover:text-rose-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("noPayments")}</p>
      )}

      {open && (
        <form onSubmit={add} className="space-y-2 border-t border-border pt-3">
          <p className="text-sm font-medium">{t("recordPayment")}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <label className={labelCls}>{t("amount")} ({loan.currency})</label>
              <input required inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t("paidOn")}</label>
              <input type="date" required max={todayISO()} value={form.paid_on} onChange={(e) => setForm({ ...form, paid_on: e.target.value })} className={inputCls} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>{t("method")}</label>
              <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className={inputCls}>
                <option value="">—</option>
                {METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("add")}
          </button>
        </form>
      )}
    </Card>
  );
}

export default function LoanPage() {
  const { id } = useParams();
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const justCreated = useLocation().state?.justCreated;
  const [loan, setLoan] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(() => {
    api
      .getLoan(id)
      .then(setLoan)
      .catch((e) => setError(e?.response?.status === 404 ? "404" : errorText(e)));
  }, [api, id]);
  useEffect(load, [load]);

  const act = async (fn) => {
    setActionError(null);
    try {
      setLoan(await fn());
    } catch (err) {
      setActionError(errorText(err));
    }
  };

  if (error)
    return (
      <div className="mx-auto max-w-xl px-4 py-10 text-center">
        <p className="text-muted-foreground">{error === "404" ? "Not found." : error}</p>
        <Link to="/onsave/money" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
          {t("back")}
        </Link>
      </div>
    );
  if (!loan)
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );

  const open = loan.status === "open";
  const due = dueLabel(loan, t);
  const first = loan.counterparty_name;
  const pct = Math.min(100, Math.round((loan.paid_cents / loan.amount_cents) * 100));
  const btn = "rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6 lg:px-8">
      <div className="flex items-center justify-between">
        <Link to="/onsave/money" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {t("back")}
        </Link>
        <LangSwitch />
      </div>

      <Card>
        <p className="text-sm text-muted-foreground">
          {loan.direction === "lent" ? t("lentTo") : t("borrowedFrom")} · {formatDate(loan.lent_on, lang)}
          {loan.note && ` · ${loan.note}`}
        </p>
        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-bold">
          {loan.counterparty_name} {open ? <ResponseBadge response={loan.response} /> : <StatusBadge status={loan.status} />}
        </h1>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[
            [t("original"), loan.amount_cents],
            [t("paid"), loan.paid_cents],
            [t("outstanding"), loan.outstanding_cents],
          ].map(([label, cents], i) => (
            <div key={label} className={cn("rounded-xl p-2", i === 2 ? "bg-primary/10" : "bg-muted")}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={cn("font-bold", i === 2 ? "text-lg text-primary" : "")}>{formatMoney(cents, loan.currency, lang)}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        {open && (
          <p className="mt-3 text-sm">
            {loan.due_on ? `${formatDate(loan.due_on, lang)} · ` : ""}
            <span className={cn(due.late && "font-semibold text-rose-600")}>{due.text}</span>
          </p>
        )}
        <p className="mt-3 text-sm">
          {loan.response === "confirmed" && <Badge tone="green">{t("theyConfirmed", { name: first })}</Badge>}
          {loan.response === "declined" && <Badge tone="red">{t("theyDisputed", { name: first })}</Badge>}
          {loan.response === "pending" && open && <span className="text-muted-foreground">{t("theyHaventConfirmed", { name: first })}</span>}
          {loan.response_note && <span className="mt-1 block italic text-muted-foreground">“{loan.response_note}”</span>}
        </p>
      </Card>

      {open && (justCreated || loan.response !== "confirmed") && (
        <ShareCard
          loan={loan}
          onRotate={() => window.confirm(t("newLinkConfirm")) && act(() => api.rotateLink(loan.id))}
        />
      )}
      {open && loan.direction === "lent" && <ReminderCard loan={loan} onChange={setLoan} />}
      <PaymentCard loan={loan} onChange={setLoan} />

      <Card className="flex flex-wrap gap-2">
        {open ? (
          <>
            <button className={btn} onClick={() => act(() => api.setLoanStatus(loan.id, "paid"))}>{t("markPaid")}</button>
            {loan.direction === "lent" && (
              <button className={btn} onClick={() => act(() => api.setLoanStatus(loan.id, "forgiven"))}>{t("forgive")}</button>
            )}
            <button className={btn} onClick={() => act(() => api.setLoanStatus(loan.id, "cancelled"))}>{t("cancelLoan")}</button>
          </>
        ) : (
          loan.outstanding_cents > 0 && (
            <button className={btn} onClick={() => act(() => api.setLoanStatus(loan.id, "open"))}>{t("reopen")}</button>
          )
        )}
        <button
          className={cn(btn, "ml-auto border-rose-500/40 text-rose-600 hover:bg-rose-500/10")}
          onClick={async () => {
            if (!window.confirm(t("deleteConfirm"))) return;
            try {
              await api.deleteLoan(loan.id);
              navigate("/onsave/money", { replace: true });
            } catch (err) {
              setActionError(errorText(err));
            }
          }}
        >
          {t("deleteLoan")}
        </button>
        {actionError && <p className="w-full text-sm text-rose-600">{actionError}</p>}
      </Card>
      <p className="text-center text-xs text-muted-foreground">{t("noMoneyHandled")}</p>
    </div>
  );
}
