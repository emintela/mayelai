import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { errorText, publicCollectionApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { METHODS, formatDate, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { LangSwitch, inputCls, labelCls } from "@/pages/money/parts";
import { ContributionBadge, Progress } from "./parts";

const empty = { name: "", phone: "", amount: "", message: "", hide_name: false, hide_amount: false, sent: false, method: "" };

// What family members see through the shared link. No account needed.
export default function PublicCollectionPage() {
  const { token } = useParams();
  const t = useT();
  const lang = useLang();
  const [col, setCol] = useState(null);
  const [state, setState] = useState("loading");
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [thanks, setThanks] = useState(null);

  useEffect(() => {
    publicCollectionApi
      .get(token)
      .then((c) => {
        setCol(c);
        setState("ready");
      })
      .catch((e) => setState(e?.response?.status === 404 ? "notfound" : "error"));
  }, [token]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCol(await publicCollectionApi.pledge(token, form));
      setThanks(form.name.trim());
      setForm(empty);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const shell = (children) => (
    <div className="flex min-h-dvh flex-col items-center bg-background px-4 py-8">
      <div className="mb-6 flex w-full max-w-lg items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/logo1.png" alt="" className="h-8 w-8 rounded-lg object-contain" />
          <span className="text-lg font-bold" style={{ fontFamily: "Montserrat, sans-serif" }}>Mayel'AI</span>
        </div>
        <LangSwitch />
      </div>
      <main className="w-full max-w-lg space-y-4">{children}</main>
      <p className="mt-6 max-w-lg text-center text-xs text-muted-foreground">{t("pubFooterCol")}</p>
    </div>
  );
  const card = "rounded-2xl border border-border bg-card p-5 shadow-sm";

  if (state === "loading") return shell(<Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />);
  if (state === "notfound") return shell(<p className={cn(card, "text-center")}>{t("pubNotFound")}</p>);
  if (state === "error") return shell(<p className={cn(card, "text-center text-rose-600")}>{errorText()}</p>);

  const open = col.status === "open";

  return shell(
    <>
      <section className={cn(card, "space-y-3")}>
        <p className="text-sm text-muted-foreground">
          {t(`kind_${col.kind}`)}
          {col.deadline && open && ` · ${formatDate(col.deadline, lang, true)}`}
        </p>
        <h1 className="text-2xl font-bold">{col.title}</h1>
        <p className="text-sm text-muted-foreground">
          {col.beneficiary && `${t("pubFor", { who: col.beneficiary })} · `}
          {t("pubOrganizedBy", { owner: col.owner_name || "Mayel'AI" })}
        </p>
        <Progress col={col} />
        {col.description && <p className="whitespace-pre-wrap rounded-xl bg-muted p-3 text-sm">{col.description}</p>}
      </section>

      {!open ? (
        <p className={cn(card, "text-center")}>{t("pubClosedCol")}</p>
      ) : thanks ? (
        <section className={cn(card, "space-y-2 text-center")}>
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
          <p className="font-semibold">{t("pubThanks", { name: thanks })}</p>
          <p className="text-sm text-muted-foreground">{t("pubThanksNext", { owner: col.owner_name || "" })}</p>
          <button onClick={() => setThanks(null)} className="text-sm font-medium text-primary hover:underline">
            {t("pubAnother")}
          </button>
        </section>
      ) : (
        <form onSubmit={submit} className={cn(card, "space-y-3")}>
          <h2 className="font-semibold">{t("pubContribute")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="name">{t("pubYourName")}</label>
              <input id="name" required maxLength={80} value={form.name} onChange={set("name")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="amount">{t("pubAmount")} ({col.currency})</label>
              <input id="amount" required inputMode="decimal" value={form.amount} onChange={set("amount")} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="phone">{t("pubYourPhone")}</label>
            <input id="phone" type="tel" inputMode="tel" maxLength={24} value={form.phone} onChange={set("phone")} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="msg">{t("pubMessage")}</label>
            <input id="msg" maxLength={300} value={form.message} onChange={set("message")} className={inputCls} />
          </div>
          <div className="space-y-1.5 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.sent} onChange={set("sent")} className="h-4 w-4" /> {t("pubAlreadySent")}
            </label>
            {form.sent && (
              <select value={form.method} onChange={set("method")} className={cn(inputCls, "ml-6 w-auto")} aria-label={t("method")}>
                <option value="">{t("method")}…</option>
                {METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.hide_name} onChange={set("hide_name")} className="h-4 w-4" /> {t("pubHideName")}
            </label>
            {col.show_amounts && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.hide_amount} onChange={set("hide_amount")} className="h-4 w-4" /> {t("pubHideAmount")}
              </label>
            )}
          </div>
          {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
          <button
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("pubPromise")}
          </button>
        </form>
      )}

      <section className={card}>
        <h2 className="font-semibold">{t("pubList")} ({col.totals.count})</h2>
        {col.contributions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("pubNone")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {[...col.contributions].reverse().map((c, i) => (
              <li key={i} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {c.name || t("anonymous")} <ContributionBadge status={c.status} />
                  </p>
                  {c.message && <p className="text-sm italic text-muted-foreground">“{c.message}”</p>}
                </div>
                <p className="shrink-0 text-sm font-semibold">
                  {c.amount_cents != null ? formatMoney(c.amount_cents, col.currency, lang) : <span className="font-normal text-muted-foreground">{t("hidden")}</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
