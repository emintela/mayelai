import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { Check, CheckCircle2, Copy, ExternalLink, X } from "lucide-react";
import { errorText, publicRequestApi, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { METHODS, formatDate, payLinks, todayISO } from "@/lib/money";
import { cn } from "@/lib/utils";
import { LangSwitch } from "@/pages/money/parts";
import { authURL } from "../Welcome";
import { ErrorNote, LogoMark, Spinner, Wordmark, btnBrand, btnGhost, btnMoney, card, field, label, money, useOnSaveChrome } from "../ui";
import { AlertsCard, StatusChip } from "./shared";

function CopyButton({ text }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => {})
      }
      className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-os-line bg-os-card px-3 text-xs font-semibold"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-os-money" /> : <Copy className="h-3.5 w-3.5" />} {copied ? t("copied") : t("copy")}
    </button>
  );
}

// Where to pay: one-tap links (Cash App, Venmo, PayPal) and handles to copy.
function PayOptions({ r }) {
  const t = useT();
  const lang = useLang();
  const links = payLinks(r.pay_to, r.amount_cents, r.currency, r.note);
  const owner = r.owner_name || "?";
  if (!links.length) return <p className="text-[13px] text-os-muted">{t("osmPayOther", { name: owner })}</p>;
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-os-muted">{t("osmPayBody")}</p>
      {links.map((l) => (
        <div key={l.name} className="flex items-center gap-3 rounded-2xl border border-os-line bg-os-bg px-3.5 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold">{l.name}</span>
            <span className="block truncate text-[13px] text-os-muted">{l.handle}</span>
          </span>
          {l.href ? (
            <a
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-os-btn-money px-3.5 text-xs font-bold text-white"
            >
              {money(r.amount_cents, r.currency, lang)} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <CopyButton text={l.copy} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function RequestReply() {
  const { token } = useParams();
  const { isLoaded, isSignedIn } = useAuth();
  const api = useApi();
  const navigate = useNavigate();
  const t = useT();
  const lang = useLang();
  useOnSaveChrome();
  const [r, setR] = useState(null);
  const [state, setState] = useState("loading");
  const [mode, setMode] = useState(null); // counter | decline | sent | thanks
  const [note, setNote] = useState("");
  const [offer, setOffer] = useState("");
  const [offerDue, setOfferDue] = useState("");
  const [method, setMethod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const claimed = useRef(false);

  useEffect(() => {
    publicRequestApi
      .get(token)
      .then((d) => {
        setR(d);
        setState("ready");
      })
      .catch((e) => setState(e?.response?.status === 404 ? "notfound" : "error"));
  }, [token]);

  // Signed in: keep it in their onSave (and get alerts). Your own request opens its page.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || state !== "ready" || claimed.current) return;
    claimed.current = true;
    api
      .claimRequest(token)
      .then((c) => {
        if (c.role === "owner") navigate(`/onsave/money/requests/${c.id}`, { replace: true });
        else setSaved(true);
      })
      .catch(() => {});
  }, [isLoaded, isSignedIn, state, api, token, navigate]);

  const act = async (action, body = {}) => {
    setBusy(true);
    setError(null);
    try {
      setR(await publicRequestApi.act(token, action, { ...body, today: todayISO() }));
      setMode(null);
      setNote("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const page = (children) => (
    <div className="onsave min-h-dvh">
      <div className="mx-auto max-w-lg">{children}</div>
    </div>
  );
  if (state === "loading") return page(<Spinner />);
  if (state !== "ready")
    return page(
      <div className="space-y-4 px-5 pt-16 text-center">
        <LogoMark size={40} className="mx-auto" />
        <p className={cn(card, "p-5 text-sm")}>{state === "notfound" ? t("osNotFound") : errorText()}</p>
      </div>
    );

  const owner = r.owner_name || "?";
  const amount = money(r.amount_cents, r.currency, lang);
  const gift = r.kind === "gift";
  const canAnswer = !gift && r.status === "pending";
  const canPay = !gift && (r.status === "accepted" || (r.status === "pending" && r.kind !== "borrow"));

  const noteField = (placeholder) => (
    <label className="block">
      <span className={label}>{placeholder}</span>
      <input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
    </label>
  );

  return page(
    <>
      <div className="bg-os-deep px-5 pb-[84px] text-white" style={{ paddingTop: "max(env(safe-area-inset-top), 24px)" }}>
        <div className="flex items-center justify-between">
          <Link to={isSignedIn ? "/onsave/money" : "/onsave/welcome"} className="flex items-center gap-2">
            <LogoMark size={26} />
            <Wordmark light className="text-base" />
          </Link>
          <LangSwitch className="border-os-deep-line bg-transparent" />
        </div>
        <p className="mt-7 text-center text-[15px] text-os-deep-muted">{t(`osmAsk_${r.kind}`, { name: owner })}</p>
        <p className="os-display mt-1 text-center text-[56px] font-extrabold leading-none tracking-tight">{amount}</p>
        {r.note && <p className="mt-3 text-center text-[15px]">“{r.note}”</p>}
      </div>

      <div className="-mt-[60px] space-y-3.5 px-5 pb-10">
        <section className={cn(card, "space-y-4 p-4 shadow-[0_12px_30px_rgba(36,26,79,0.10)]")}>
          <div className="flex items-center justify-between gap-2 text-[13px] text-os-muted">
            <span>
              {formatDate(r.created_at.slice(0, 10), lang)}
              {r.due_on && ` · ${t("osmWillPayBack", { date: formatDate(r.due_on, lang) })}`}
            </span>
            <StatusChip status={r.status} />
          </div>

          {/* Answer a borrow request */}
          {canAnswer && r.kind === "borrow" && !mode && (
            <div className="space-y-2">
              <button type="button" disabled={busy} onClick={() => act("accept")} className={cn(btnBrand, "h-14 w-full text-base")}>
                <Check className="h-5 w-5" /> {t("osmAccept")}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setMode("counter")} className={btnGhost}>
                  {t("osmOfferOther")}
                </button>
                <button type="button" onClick={() => setMode("decline")} className={btnGhost}>
                  <X className="h-4 w-4" /> {t("osmDecline")}
                </button>
              </div>
              <button type="button" onClick={() => setMode("sent")} className="w-full py-2 text-sm font-semibold text-os-brand">
                {t("osmAlreadySent")}
              </button>
            </div>
          )}

          {/* Pay: owed / help right away, borrow once accepted */}
          {canPay && mode !== "counter" && mode !== "decline" && (
            <div className="space-y-3">
              <h2 className="text-[15px] font-bold">{t("osmPayName", { name: owner })}</h2>
              <PayOptions r={r} />
              <label className="block">
                <span className={label}>{t("osmHowYouSent")}</span>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className={field}>
                  <option value="">—</option>
                  {METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <button type="button" disabled={busy} onClick={() => act("sent", { method, note })} className={cn(btnMoney, "h-14 w-full text-base")}>
                <Check className="h-5 w-5" /> {t("osmISent")}
              </button>
              {r.status === "pending" && (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setMode("counter")} className={btnGhost}>
                    {t("osmOfferOther")}
                  </button>
                  <button type="button" onClick={() => setMode("decline")} className={btnGhost}>
                    <X className="h-4 w-4" /> {t("osmDecline")}
                  </button>
                </div>
              )}
              {r.status === "accepted" && (
                <button type="button" onClick={() => setMode("decline")} className="w-full py-2 text-sm font-semibold text-os-muted">
                  {t("osmDecline")}
                </button>
              )}
            </div>
          )}

          {/* "Already sent it?" on a borrow request */}
          {canAnswer && r.kind === "borrow" && mode === "sent" && (
            <div className="space-y-3">
              <PayOptions r={r} />
              <label className="block">
                <span className={label}>{t("osmHowYouSent")}</span>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className={field}>
                  <option value="">—</option>
                  {METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <button type="button" disabled={busy} onClick={() => act("sent", { method })} className={cn(btnMoney, "w-full")}>
                <Check className="h-4 w-4" /> {t("osmISent")}
              </button>
              <button type="button" onClick={() => setMode(null)} className="w-full py-1 text-sm text-os-muted">
                {t("back")}
              </button>
            </div>
          )}

          {mode === "counter" && (
            <div className="space-y-3">
              <label className="block">
                <span className={label}>
                  {t("osmOfferAmount")} ({r.currency})
                </span>
                <input autoFocus inputMode="decimal" value={offer} onChange={(e) => setOffer(e.target.value)} className={field} />
              </label>
              {r.kind === "borrow" && (
                <label className="block">
                  <span className={label}>{t("osmOfferDate")}</span>
                  <input type="date" min={todayISO()} value={offerDue} onChange={(e) => setOfferDue(e.target.value)} className={field} />
                </label>
              )}
              {noteField(t("osmKindWord"))}
              <button
                type="button"
                disabled={busy || !offer}
                onClick={() => act("counter", { amount: offer.replace(",", "."), due_on: offerDue, note })}
                className={cn(btnBrand, "w-full")}
              >
                {t("osmSendOffer")}
              </button>
              <button type="button" onClick={() => setMode(null)} className="w-full py-1 text-sm text-os-muted">
                {t("back")}
              </button>
            </div>
          )}

          {mode === "decline" && (
            <div className="space-y-3">
              {noteField(t("osmKindWord"))}
              <button type="button" disabled={busy} onClick={() => act("decline", { note })} className={cn(btnGhost, "w-full text-os-danger")}>
                <X className="h-4 w-4" /> {t("osmDecline")}
              </button>
              <button type="button" onClick={() => setMode(null)} className="w-full py-1 text-sm text-os-muted">
                {t("back")}
              </button>
            </div>
          )}

          {/* A gift: confirm it arrived and say thanks */}
          {gift && r.status === "sent" && (
            <div className="space-y-3">
              {r.method && <p className="text-sm">{t("osmTheySent", { name: owner, via: t("osmVia", { method: r.method }) })}</p>}
              {noteField(t("osmSayThanks"))}
              <button type="button" disabled={busy} onClick={() => act("received", { note })} className={cn(btnMoney, "h-14 w-full text-base")}>
                <Check className="h-5 w-5" /> {t("osmMarkReceived")}
              </button>
            </div>
          )}

          {r.status === "countered" && r.counter_amount_cents && (
            <div className="space-y-2">
              <p className="text-sm">{t("osmYouOffered", { amount: money(r.counter_amount_cents, r.currency, lang), name: owner })}</p>
              {mode !== "decline" && (
                <button type="button" onClick={() => setMode("decline")} className="text-sm font-semibold text-os-muted">
                  {t("osmDecline")}
                </button>
              )}
            </div>
          )}
          {r.status === "sent" && !gift && <p className="text-sm">{t("osmWaitConfirm", { name: owner })}</p>}
          {r.status === "received" && (
            <p className="flex items-center gap-2 text-[15px] font-semibold text-os-money">
              <CheckCircle2 className="h-5 w-5" /> {t("osmSettled")}
            </p>
          )}
          {r.status === "declined" && <p className="text-sm text-os-muted">{t("osmDeclinedState")}</p>}
          {r.status === "cancelled" && <p className="text-sm text-os-muted">{t("osmCancelledState", { name: owner })}</p>}
          <ErrorNote>{error}</ErrorNote>
        </section>

        {isLoaded && !isSignedIn && (
          <section className={cn(card, "space-y-3 p-4")}>
            <p className="text-[15px] font-semibold">{t("osmGetAlerts")}</p>
            <p className="text-[13px] text-os-muted">{t("osmGetAlertsBody")}</p>
            <Link to={authURL("sign-up", `/r/${token}`)} className={cn(btnBrand, "w-full")}>
              {t("osGetStarted")}
            </Link>
            <Link to={authURL("sign-in", `/r/${token}`)} className="block text-center text-sm font-semibold text-os-brand">
              {t("osHaveAccount")}
            </Link>
          </section>
        )}
        {isSignedIn && saved && (
          <>
            <p className="text-center text-[13px] text-os-muted">
              {t("osmSavedInApp")}{" "}
              <Link to="/onsave/money" className="font-semibold text-os-brand">
                {t("osmOpenApp")}
              </Link>
            </p>
            <AlertsCard compact labelKey="osmAlertsShort" />
          </>
        )}
        <p className="pt-2 text-center text-xs text-os-muted">{t("osmNoMoneyMoves")}</p>
      </div>
    </>
  );
}
