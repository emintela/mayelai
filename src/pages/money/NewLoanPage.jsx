import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { CURRENCIES, todayISO } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Card, LangSwitch, inputCls, labelCls } from "./parts";

const NAME_KEY = "mayelai.ownerName";
const CURRENCY_KEY = "mayelai.currency";
const remember = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const store = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

export default function NewLoanPage() {
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const { user } = useUser();
  const draft = useLocation().state?.draft;

  const [form, setForm] = useState(() => ({
    direction: draft?.direction || "lent",
    counterparty_name: draft?.counterparty_name || "",
    counterparty_phone: "",
    amount: draft?.amount || "",
    currency: draft?.currency || remember(CURRENCY_KEY) || "USD",
    lent_on: draft?.lent_on || todayISO(),
    due_on: draft?.due_on || "",
    note: draft?.note || "",
    reminder_language: lang,
    owner_name: remember(NAME_KEY) || user?.firstName || "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [upgrade, setUpgrade] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const loan = await api.createLoan({ ...form, today: todayISO() });
      store(NAME_KEY, form.owner_name);
      store(CURRENCY_KEY, form.currency);
      navigate(`/money/${loan.id}`, { replace: true, state: { justCreated: true } });
    } catch (err) {
      setError(errorText(err));
      setUpgrade(!!err?.response?.data?.upgrade);
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-6 lg:px-8">
      <div className="mb-4 flex items-center justify-between">
        <Link to="/money" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {t("back")}
        </Link>
        <LangSwitch />
      </div>
      <h1 className="text-2xl font-bold">{t("newLoan")}</h1>
      {draft && (
        <p className="mt-2 flex items-center gap-1.5 rounded-xl bg-primary/10 px-3 py-2 text-sm text-primary">
          <Sparkles className="h-4 w-4 shrink-0" /> {t("aiFilled")}
        </p>
      )}

      <form onSubmit={submit} className="mt-4 space-y-4">
        <Card className="space-y-4">
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {[
              ["lent", t("iLent")],
              ["borrowed", t("iBorrowed")],
            ].map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={form.direction === v}
                onClick={() => setForm((f) => ({ ...f, direction: v }))}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-sm font-medium transition",
                  form.direction === v ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div>
            <label className={labelCls} htmlFor="name">{t("theirName")}</label>
            <input id="name" required maxLength={80} value={form.counterparty_name} onChange={set("counterparty_name")} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="phone">{t("theirPhone")}</label>
            <input id="phone" type="tel" inputMode="tel" maxLength={24} placeholder="+1 555 123 4567" value={form.counterparty_phone} onChange={set("counterparty_phone")} className={inputCls} />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div>
              <label className={labelCls} htmlFor="amount">{t("amount")}</label>
              <input id="amount" required inputMode="decimal" placeholder="200" value={form.amount} onChange={set("amount")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="currency">{t("currency")}</label>
              <select id="currency" value={form.currency} onChange={set("currency")} className={inputCls}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls} htmlFor="lent_on">{t("dateLent")}</label>
              <input id="lent_on" type="date" required max={todayISO()} value={form.lent_on} onChange={set("lent_on")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="due_on">{t("dueDate")}</label>
              <input id="due_on" type="date" min={form.lent_on} value={form.due_on} onChange={set("due_on")} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="note">{t("note")}</label>
            <input id="note" maxLength={500} placeholder={t("notePlaceholder")} value={form.note} onChange={set("note")} className={inputCls} />
          </div>
        </Card>

        <Card className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="owner">{t("yourName")}</label>
            <input id="owner" maxLength={80} value={form.owner_name} onChange={set("owner_name")} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="rlang">{t("reminderLanguage")}</label>
            <select id="rlang" value={form.reminder_language} onChange={set("reminder_language")} className={inputCls}>
              <option value="fr">Français</option>
              <option value="en">English</option>
              <option value="ln" disabled>{t("lingalaSoon")}</option>
            </select>
          </div>
        </Card>

        {error && (
          <p role="alert" className="text-sm text-rose-600">
            {error}{" "}
            {upgrade && (
              <Link to="/settings" className="font-medium text-primary hover:underline">
                {t("upgrade")}
              </Link>
            )}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {saving ? t("saving") : t("save")}
          </button>
          <Link to="/money" className="rounded-full border border-border px-6 py-2.5 text-sm font-medium hover:bg-accent">
            {t("cancel")}
          </Link>
        </div>
      </form>
    </div>
  );
}
