import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ContactsButton, SendToPeople } from "@/components/contacts";
import { ArrowLeft, BellRing, Link2, Loader2, Megaphone, RefreshCw, Trash2 } from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { METHODS, collectionLink, formatDate, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { AIDraftBox, Card, LangSwitch, SendButtons, inputCls, labelCls } from "@/pages/money/parts";
import { ContributionBadge, Progress } from "./parts";

// AI-written message (group update or personal reminder) for a collection.
function DraftBox({ col, purpose, contribution, phone, onSent, onClose }) {
  const api = useApi();
  return (
    <AIDraftBox
      fetchDraft={(language) => api.collectionDraft(col.id, { purpose, language, contribution_id: contribution?.id })}
      link={col.status === "open" ? collectionLink(col.share_token) : ""}
      phone={phone}
      onSent={onSent}
      onClose={onClose}
    />
  );
}

function ContributionRow({ col, c, onChange, onError }) {
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const [reminding, setReminding] = useState(false);
  const open = col.status === "open";
  const act = async (fn) => {
    try {
      onChange(await fn());
    } catch (err) {
      onError(errorText(err));
    }
  };
  const small = "rounded-full border border-border px-3 py-1 text-xs font-medium transition hover:bg-accent";

  return (
    <li className="space-y-2 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {c.name} <ContributionBadge status={c.status} />
            {c.hide_name && <span className="text-xs text-muted-foreground">({t("anonymous").toLowerCase()})</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDate(c.created_at, lang)}
            {c.method && ` · ${c.method}`}
            {c.phone && ` · ${c.phone}`}
            {c.reminders_count > 0 && ` · ${t("remindedOn", { date: formatDate(c.last_reminded_at, lang) })}`}
          </p>
          {c.message && <p className="mt-1 text-sm italic text-muted-foreground">“{c.message}”</p>}
        </div>
        <p className="shrink-0 font-semibold">{formatMoney(c.amount_cents, col.currency, lang)}</p>
      </div>
      {open && (
        <div className="flex flex-wrap gap-1.5">
          {c.status !== "received" && (
            <button className={cn(small, "border-emerald-600/40 text-emerald-700")} onClick={() => act(() => api.setContributionStatus(col.id, c.id, "received"))}>
              {t("confirmReceived")}
            </button>
          )}
          {c.status === "pledged" && (
            <button className={small} onClick={() => setReminding((r) => !r)}>
              <BellRing className="mr-1 inline h-3 w-3" /> {t("remind")}
            </button>
          )}
          {c.status !== "pledged" && (
            <button className={small} onClick={() => act(() => api.setContributionStatus(col.id, c.id, "pledged"))}>
              {t("backToPromised")}
            </button>
          )}
          <button
            className={cn(small, "ml-auto text-rose-600")}
            aria-label={t("remove")}
            onClick={() => window.confirm(`${t("remove")} — ${c.name}?`) && act(() => api.deleteContribution(col.id, c.id))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {reminding && (
        <DraftBox
          col={col}
          purpose="reminder"
          contribution={c}
          phone={c.phone}
          onClose={() => setReminding(false)}
          onSent={() => act(() => api.markReminded(col.id, c.id))}
        />
      )}
    </li>
  );
}

function AddContribution({ col, onChange }) {
  const api = useApi();
  const t = useT();
  const empty = { name: "", amount: "", method: "", received: true, phone: "" };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onChange(await api.addContribution(col.id, form));
      setForm(empty);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="rounded-xl border border-dashed border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">{t("addContribution")}</summary>
      <p className="mt-1 text-xs text-muted-foreground">{t("addContributionBody")}</p>
      <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <div className="flex items-end justify-between gap-2">
            <label className={labelCls}>{t("theirName")}</label>
            <ContactsButton
              onPick={([p]) => setForm((f) => ({ ...f, name: p.name, phone: p.phone }))}
              className="mb-1 rounded-full px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/10"
            />
          </div>
          <input required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
          {form.phone && <p className="mt-1 text-xs text-muted-foreground">{form.phone}</p>}
        </div>
        <div>
          <label className={labelCls}>{t("amount")} ({col.currency})</label>
          <input required inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>{t("method")}</label>
          <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className={inputCls}>
            <option value="">—</option>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={form.received} onChange={(e) => setForm({ ...form, received: e.target.checked })} className="h-4 w-4" />
          {t("alreadyReceived")}
        </label>
        {error && <p className="text-sm text-rose-600 sm:col-span-2">{error}</p>}
        <button disabled={busy} className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("add")}
        </button>
      </form>
    </details>
  );
}

export default function CollectionPage() {
  const { id } = useParams();
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const [col, setCol] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [invitees, setInvitees] = useState([]); // picked from contacts

  const load = useCallback(() => {
    api.getCollection(id).then(setCol).catch((e) => setError(e?.response?.status === 404 ? "Not found." : errorText(e)));
  }, [api, id]);
  useEffect(load, [load]);

  const act = async (fn) => {
    setActionError(null);
    try {
      setCol(await fn());
    } catch (err) {
      setActionError(errorText(err));
    }
  };

  if (error)
    return (
      <div className="mx-auto max-w-xl px-4 py-10 text-center">
        <p className="text-muted-foreground">{error}</p>
        <Link to="/onsave/collections" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">{t("back")}</Link>
      </div>
    );
  if (!col)
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );

  const open = col.status === "open";
  const link = collectionLink(col.share_token);
  const shareText = t("shareCollectionMessage", { title: col.title, link });
  const btn = "rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6 lg:px-8">
      <div className="flex items-center justify-between">
        <Link to="/onsave/collections" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {t("back")}
        </Link>
        <LangSwitch />
      </div>

      <Card className="space-y-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {t(`kind_${col.kind}`)}
            {col.beneficiary && ` · ${t("pubFor", { who: col.beneficiary })}`}
            {col.deadline && ` · ${formatDate(col.deadline, lang)}`}
          </p>
          <h1 className="text-2xl font-bold">{col.title}</h1>
          {!open && <p className="mt-1 text-sm font-medium text-muted-foreground">{t("collectionClosed")}</p>}
        </div>
        <Progress col={col} />
        {col.description && <p className="whitespace-pre-wrap rounded-xl bg-muted p-3 text-sm">{col.description}</p>}
      </Card>

      {open && (
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <Link2 className="h-4 w-4 text-primary" /> {t("shareCollection")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("shareCollectionBody")}</p>
          <p className="break-all rounded-xl bg-muted p-3 text-sm">{shareText}</p>
          <ContactsButton
            multiple
            onPick={setInvitees}
            className="rounded-full border border-primary/40 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10"
          >
            {t("osInviteFromContacts")}
          </ContactsButton>
          <SendToPeople people={invitees} message={() => shareText} onClose={() => setInvitees([])} />
          <div className="flex flex-wrap items-center gap-2">
            <SendButtons text={shareText} />
            <button
              onClick={() => window.confirm(t("newLinkConfirm")) && act(() => api.rotateCollectionLink(col.id))}
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5" /> {t("newLink")}
            </button>
          </div>
        </Card>
      )}

      <Card className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Megaphone className="h-4 w-4 text-primary" /> {t("groupUpdate")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("groupUpdateBody")}</p>
        <DraftBox col={col} purpose="update" />
      </Card>

      <Card className="space-y-2">
        <h2 className="font-semibold">
          {t("contributions")} ({col.contributions?.length ?? 0})
        </h2>
        {col.contributions?.length ? (
          <ul className="divide-y divide-border">
            {[...col.contributions].reverse().map((c) => (
              <ContributionRow key={c.id} col={col} c={c} onChange={setCol} onError={setActionError} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noContributions")}</p>
        )}
        {open && <AddContribution col={col} onChange={setCol} />}
      </Card>

      <Card className="flex flex-wrap items-center gap-2">
        {open && (
          <label className="flex w-full items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={col.show_amounts}
              onChange={(e) => act(() => api.updateCollection(col.id, { show_amounts: e.target.checked }))}
              className="h-4 w-4"
            />
            {t("showAmounts")}
          </label>
        )}
        <button className={btn} onClick={() => act(() => api.setCollectionStatus(col.id, open ? "closed" : "open"))}>
          {open ? t("closeCollection") : t("reopenCollection")}
        </button>
        <button
          className={cn(btn, "ml-auto border-rose-500/40 text-rose-600 hover:bg-rose-500/10")}
          onClick={async () => {
            if (!window.confirm(t("deleteCollectionConfirm"))) return;
            try {
              await api.deleteCollection(col.id);
              navigate("/onsave/collections", { replace: true });
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
