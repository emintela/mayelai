import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Bell, Check, Link2, X } from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { formatDate, todayISO } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ShareButtons } from "../GroupDetail";
import { Avatar, ErrorNote, Spinner, TopBar, btnBrand, btnGhost, btnMoney, card, money } from "../ui";
import { KindIcon, StatusChip, messageFor, ownerReceives } from "./shared";

// One request you made: its status, the other person's answer, what to do next.
export default function RequestDetail() {
  const { id } = useParams();
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resend, setResend] = useState(false);

  useEffect(() => {
    api.getRequest(id).then(setData).catch((e) => setError(e?.response?.status === 404 ? t("osNotFound") : errorText(e)));
  }, [api, id, t]);

  if (!data) return error ? <p className="py-10 text-center text-sm text-os-muted">{error}</p> : <Spinner />;
  const r = data.request;
  const name = r.counterparty_name;
  const amount = money(r.amount_cents, r.currency, lang);
  const open = ["pending", "countered", "accepted", "sent"].includes(r.status);

  const act = async (action) => {
    if (action === "cancel" && !window.confirm(t("osmCancelConfirm"))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestAction(r.id, action, todayISO());
      setData((d) => ({ ...d, request: res.request, split: d.split.map((p) => (p.id === res.request.id ? res.request : p)) }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const text = messageFor(
    { kind: r.kind, name, cents: r.amount_cents, currency: r.currency, note: r.note, due: r.due_on, token: r.share_token },
    t,
    lang
  );

  return (
    <div className="space-y-4 pt-2">
      <TopBar back="/onsave/money">
        <StatusChip status={r.status} />
      </TopBar>

      <section className="pt-2 text-center">
        <div className="flex justify-center">
          <KindIcon kind={r.kind} size={56} />
        </div>
        <p className="mt-3 text-sm text-os-muted">{t(`osmRow_${r.kind}`, { name })}</p>
        <p className="os-display mt-1 text-[48px] font-extrabold leading-none tracking-tight">{amount}</p>
        {r.note && <p className="mt-2 text-[15px]">“{r.note}”</p>}
        <p className="mt-2 text-[13px] text-os-muted">
          {formatDate(r.created_at.slice(0, 10), lang)}
          {r.due_on && ` · ${t("osmPayBack", { date: formatDate(r.due_on, lang) })}`}
        </p>
        {r.linked && (
          <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-os-brand-soft px-3 py-1 text-xs font-semibold text-os-brand-ink">
            <Bell className="h-3.5 w-3.5" /> {t("osmLinked", { name })}
          </p>
        )}
      </section>

      {/* Their answer */}
      {r.status === "countered" && r.counter_amount_cents && (
        <section className={cn(card, "space-y-3 border-os-warn/40 p-4")}>
          <p className="text-[15px] font-bold">{t("osmOffer", { name, amount: money(r.counter_amount_cents, r.currency, lang) })}</p>
          {r.counter_due_on && <p className="text-[13px] text-os-muted">{t("osmPayBack", { date: formatDate(r.counter_due_on, lang) })}</p>}
          {r.response_note && <p className="rounded-2xl bg-os-bg p-3 text-sm">“{r.response_note}”</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => act("accept_counter")} className={btnMoney}>
              <Check className="h-4 w-4" /> {t("osmAcceptOffer", { amount: money(r.counter_amount_cents, r.currency, lang) })}
            </button>
            <button type="button" disabled={busy} onClick={() => act("cancel")} className={btnGhost}>
              <X className="h-4 w-4" /> {t("osmCancelReq")}
            </button>
          </div>
        </section>
      )}
      {r.status === "sent" && ownerReceives(r) && (
        <section className={cn(card, "space-y-3 border-os-money/40 p-4")}>
          <p className="text-[15px] font-bold">{t("osmTheySent", { name, via: r.method ? t("osmVia", { method: r.method }) : "" })}</p>
          {r.response_note && <p className="rounded-2xl bg-os-bg p-3 text-sm">“{r.response_note}”</p>}
          <button type="button" disabled={busy} onClick={() => act("received")} className={cn(btnMoney, "w-full")}>
            <Check className="h-4 w-4" /> {t("osmMarkReceived")}
          </button>
        </section>
      )}
      {r.status !== "countered" && r.status !== "sent" && r.response_note && (
        <section className={cn(card, "p-4")}>
          <p className="text-xs font-semibold text-os-muted">{t("osmTheirNote")}</p>
          <p className="mt-1 text-sm">“{r.response_note}”</p>
        </section>
      )}
      {r.thanks_note && (
        <section className={cn(card, "p-4")}>
          <p className="text-xs font-semibold text-os-muted">{t("osmThanksNote")}</p>
          <p className="mt-1 text-sm">“{r.thanks_note}”</p>
        </section>
      )}
      {r.loan_id && (
        <Link to={`/onsave/money/${r.loan_id}`} className={cn(card, "flex items-center justify-between gap-3 p-4 text-sm")}>
          <span>{t("osmBecameLoan")}</span>
          <span className="font-semibold text-os-brand">{t("osmSeeLoan")}</span>
        </Link>
      )}

      {/* Bill split */}
      {data.split.length > 1 && (
        <section className="space-y-2">
          <h2 className="text-[15px] font-bold">{t("osmSplitWith")}</h2>
          <ul className={cn(card, "divide-y divide-os-line-soft overflow-hidden")}>
            {data.split.map((p) => (
              <li key={p.id}>
                <Link to={`/onsave/money/requests/${p.id}`} className={cn("flex items-center gap-3 px-4 py-3", p.id === r.id && "bg-os-brand-soft/50")}>
                  <Avatar name={p.counterparty_name} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.counterparty_name}</span>
                  <span className="text-sm font-semibold">{money(p.amount_cents, p.currency, lang)}</span>
                  <StatusChip status={p.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ErrorNote>{error}</ErrorNote>

      {open && (
        <div className="space-y-2">
          {ownerReceives(r) && ["pending", "accepted"].includes(r.status) && (
            <button type="button" disabled={busy} onClick={() => act("received")} className={cn(btnBrand, "w-full")}>
              <Check className="h-4 w-4" /> {t("osmMarkReceived")}
            </button>
          )}
          <button type="button" onClick={() => setResend((v) => !v)} className={cn(btnGhost, "w-full")}>
            <Link2 className="h-4 w-4" /> {t("osmSendAgain")}
          </button>
          {resend && (
            <div className={cn(card, "space-y-3 p-4")}>
              <p className="break-words rounded-2xl bg-os-bg p-3 text-sm">{text}</p>
              <ShareButtons text={text} phone={r.counterparty_phone} />
            </div>
          )}
          {r.status !== "countered" && (
            <button type="button" disabled={busy} onClick={() => act("cancel")} className="w-full py-3 text-sm font-semibold text-os-danger">
              {t("osmCancelReq")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
