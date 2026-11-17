import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { errorText, publicLoanApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { formatDate, formatMoney } from "@/lib/money";
import { LangSwitch, inputCls } from "./parts";

// What the other person sees through the shared link. No account needed.
export default function PublicLoanPage() {
  const { token } = useParams();
  const t = useT();
  const lang = useLang();
  const [loan, setLoan] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | notfound | error
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    publicLoanApi
      .get(token)
      .then((l) => {
        setLoan(l);
        setState("ready");
      })
      .catch((e) => setState(e?.response?.status === 404 ? "notfound" : "error"));
  }, [token]);

  const respond = async (response) => {
    setBusy(true);
    setError(null);
    try {
      setLoan(await publicLoanApi.respond(token, response, note));
      setChanging(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const shell = (children) => (
    <div className="flex min-h-dvh flex-col items-center bg-background px-4 py-8">
      <div className="mb-6 flex w-full max-w-md items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/logo1.png" alt="" className="h-8 w-8 rounded-lg object-contain" />
          <span className="text-lg font-bold" style={{ fontFamily: "Montserrat, sans-serif" }}>Mayel'AI</span>
        </div>
        <LangSwitch />
      </div>
      <main className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">{children}</main>
      <p className="mt-4 max-w-md text-center text-xs text-muted-foreground">{t("pubFooter")}</p>
    </div>
  );

  if (state === "loading") return shell(<Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />);
  if (state === "notfound") return shell(<p className="text-center">{t("pubNotFound")}</p>);
  if (state === "error") return shell(<p className="text-center text-rose-600">{errorText()}</p>);

  const amount = formatMoney(loan.amount_cents, loan.currency, lang);
  const open = loan.status === "open";
  const answered = loan.response !== "pending" && !changing;

  return shell(
    <div className="space-y-4">
      <p className="text-lg">
        {t(loan.direction === "lent" ? "pubLent" : "pubBorrowed", {
          owner: loan.owner_name || "Mayel'AI",
          amount,
          date: formatDate(loan.lent_on, lang, true),
        })}
      </p>
      {loan.note && <p className="text-sm text-muted-foreground">“{loan.note}”</p>}
      {loan.paid_cents > 0 && (
        <p className="font-semibold">{t("pubStill", { amount: formatMoney(loan.outstanding_cents, loan.currency, lang) })}</p>
      )}
      {loan.due_on && open && <p className="text-sm">{t("pubDue", { date: formatDate(loan.due_on, lang, true) })}</p>}

      {!open ? (
        <p className="rounded-xl bg-muted p-3 text-sm">{t("pubClosed")}</p>
      ) : answered ? (
        <div className="space-y-2 rounded-xl bg-muted p-4">
          <p className="flex items-center gap-2 font-medium">
            {loan.response === "confirmed" ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <XCircle className="h-5 w-5 text-rose-600" />
            )}
            {t(loan.response === "confirmed" ? "pubThanksYes" : "pubThanksNo", { owner: loan.owner_name || "" })}
          </p>
          <button onClick={() => setChanging(true)} className="text-sm font-medium text-primary hover:underline">
            {t("pubChange")}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="font-semibold">{t("pubConfirmQ")}</p>
          <textarea
            rows={2}
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("pubNote")}
            className={inputCls}
          />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              disabled={busy}
              onClick={() => respond("confirmed")}
              className="inline-flex items-center justify-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {t("pubYes")}
            </button>
            <button
              disabled={busy}
              onClick={() => respond("declined")}
              className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border px-4 py-2.5 text-sm font-medium hover:bg-accent disabled:opacity-60"
            >
              <XCircle className="h-4 w-4" /> {t("pubNo")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
