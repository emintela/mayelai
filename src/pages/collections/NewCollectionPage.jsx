import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { CURRENCIES, KINDS, todayISO } from "@/lib/money";
import { Card, LangSwitch, inputCls, labelCls } from "@/pages/money/parts";

const read = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

export default function NewCollectionPage() {
  const api = useApi();
  const t = useT();
  const navigate = useNavigate();
  const { user } = useUser();
  const [form, setForm] = useState(() => ({
    kind: "funeral",
    title: "",
    beneficiary: "",
    description: "",
    currency: read("mayelai.currency") || "USD",
    goal: "",
    deadline: "",
    show_amounts: true,
    owner_name: read("mayelai.ownerName") || user?.firstName || "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [upgrade, setUpgrade] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const col = await api.createCollection({ ...form, today: todayISO() });
      navigate(`/onsave/collections/${col.id}`, { replace: true });
    } catch (err) {
      setError(errorText(err));
      setUpgrade(!!err?.response?.data?.upgrade);
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-6 lg:px-8">
      <div className="mb-4 flex items-center justify-between">
        <Link to="/onsave/collections" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {t("back")}
        </Link>
        <LangSwitch />
      </div>
      <h1 className="text-2xl font-bold">{t("newCollection")}</h1>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <Card className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="kind">{t("occasion")}</label>
            <select id="kind" value={form.kind} onChange={set("kind")} className={inputCls}>
              {KINDS.map((k) => (
                <option key={k} value={k}>{t(`kind_${k}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="title">{t("colTitle")}</label>
            <input id="title" required maxLength={120} placeholder={t("colTitlePlaceholder")} value={form.title} onChange={set("title")} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="beneficiary">{t("beneficiary")}</label>
            <input id="beneficiary" maxLength={120} placeholder={t("beneficiaryPlaceholder")} value={form.beneficiary} onChange={set("beneficiary")} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="description">{t("howToSend")}</label>
            <textarea id="description" rows={3} maxLength={1000} placeholder={t("howToSendPlaceholder")} value={form.description} onChange={set("description")} className={inputCls} />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div>
              <label className={labelCls} htmlFor="goal">{t("goal")}</label>
              <input id="goal" inputMode="decimal" value={form.goal} onChange={set("goal")} className={inputCls} />
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
          <div>
            <label className={labelCls} htmlFor="deadline">{t("deadline")}</label>
            <input id="deadline" type="date" min={todayISO()} value={form.deadline} onChange={set("deadline")} className={inputCls} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.show_amounts} onChange={set("show_amounts")} className="h-4 w-4 accent-[var(--primary)]" />
            {t("showAmounts")}
          </label>
        </Card>
        <Card>
          <label className={labelCls} htmlFor="owner">{t("yourName")}</label>
          <input id="owner" maxLength={80} value={form.owner_name} onChange={set("owner_name")} className={inputCls} />
        </Card>
        {error && (
          <p role="alert" className="text-sm text-rose-600">
            {error}{" "}
            {upgrade && (
              <Link to="/settings" className="font-medium text-primary hover:underline">{t("upgrade")}</Link>
            )}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {saving ? t("saving") : t("save")}
          </button>
          <Link to="/onsave/collections" className="rounded-full border border-border px-6 py-2.5 text-sm font-medium hover:bg-accent">
            {t("cancel")}
          </Link>
        </div>
      </form>
    </div>
  );
}
