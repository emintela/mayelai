import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { CURRENCIES, FREQUENCIES } from "@/lib/money";
import { Card, LangSwitch, inputCls, labelCls } from "@/pages/money/parts";

const read = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

export default function NewGroupPage() {
  const api = useApi();
  const t = useT();
  const navigate = useNavigate();
  const { user } = useUser();
  const [form, setForm] = useState(() => ({
    name: "",
    amount: "",
    currency: read("mayelai.currency") || "USD",
    frequency: "monthly",
    rules: "",
    include_me: true,
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
      const g = await api.createGroup(form);
      navigate(`/likelemba/${g.id}`, { replace: true });
    } catch (err) {
      setError(errorText(err));
      setUpgrade(!!err?.response?.data?.upgrade);
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-6 lg:px-8">
      <div className="mb-4 flex items-center justify-between">
        <Link to="/likelemba" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {t("back")}
        </Link>
        <LangSwitch />
      </div>
      <h1 className="text-2xl font-bold">{t("newGroup")}</h1>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <Card className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="name">{t("groupName")}</label>
            <input id="name" required maxLength={120} placeholder={t("groupNamePlaceholder")} value={form.name} onChange={set("name")} className={inputCls} />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div>
              <label className={labelCls} htmlFor="amount">{t("contribution")}</label>
              <input id="amount" required inputMode="decimal" placeholder="100" value={form.amount} onChange={set("amount")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="currency">{t("currency")}</label>
              <select id="currency" value={form.currency} onChange={set("currency")} className={inputCls}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="frequency">{t("frequency")}</label>
            <select id="frequency" value={form.frequency} onChange={set("frequency")} className={inputCls}>
              {FREQUENCIES.map((f) => <option key={f} value={f}>{t(`freq_${f}`)}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="rules">{t("groupRules")}</label>
            <textarea id="rules" rows={3} maxLength={1000} placeholder={t("groupRulesPlaceholder")} value={form.rules} onChange={set("rules")} className={inputCls} />
          </div>
        </Card>
        <Card className="space-y-3">
          <div>
            <label className={labelCls} htmlFor="owner">{t("yourName")}</label>
            <input id="owner" maxLength={80} value={form.owner_name} onChange={set("owner_name")} className={inputCls} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.include_me} onChange={set("include_me")} className="h-4 w-4" /> {t("includeMe")}
          </label>
        </Card>
        {error && (
          <p role="alert" className="text-sm text-rose-600">
            {error} {upgrade && <Link to="/settings" className="font-medium text-primary hover:underline">{t("upgrade")}</Link>}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {saving ? t("saving") : t("save")}
          </button>
          <Link to="/likelemba" className="rounded-full border border-border px-6 py-2.5 text-sm font-medium hover:bg-accent">{t("cancel")}</Link>
        </div>
      </form>
    </div>
  );
}
