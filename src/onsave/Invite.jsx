import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { Check, CheckCircle2 } from "lucide-react";
import { errorText, publicGroupApi, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { METHODS, formatDate } from "@/lib/money";
import { cn } from "@/lib/utils";
import { LangSwitch } from "@/pages/money/parts";
import { readMember, saveMember } from "./memberStore";
import {
  Avatar,
  AvatarStack,
  ErrorNote,
  LogoMark,
  PaymentChip,
  Spinner,
  Wordmark,
  btnBrand,
  btnMoney,
  card,
  currentRound,
  field,
  label,
  money,
  paymentOf,
  useOnSaveChrome,
} from "./ui";
import { authURL } from "./Welcome";

// The shared group link (/g/:token). Works without an account: people join,
// and with their personal link (?m=) they say "I paid". Signed-in people are
// linked to their account and sent to the group in the app.
export default function Invite() {
  const { token } = useParams();
  const [params, setParams] = useSearchParams();
  const { isLoaded, isSignedIn } = useAuth();
  const api = useApi();
  const navigate = useNavigate();
  const t = useT();
  const lang = useLang();
  useOnSaveChrome();
  const [memberToken, setMemberToken] = useState(() => params.get("m") || readMember(token));
  const [g, setG] = useState(null);
  const [state, setState] = useState("loading");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [joined, setJoined] = useState(false);
  const claimed = useRef(false);

  // Remember a personal link on this device, then hide it from the address bar.
  useEffect(() => {
    const m = params.get("m");
    if (m) {
      saveMember(token, m);
      params.delete("m");
      setParams(params, { replace: true });
    }
  }, [params, setParams, token]);

  useEffect(() => {
    publicGroupApi
      .get(token, memberToken)
      .then((data) => {
        setG(data);
        setState("ready");
      })
      .catch((e) => setState(e?.response?.status === 404 ? "notfound" : "error"));
  }, [token, memberToken]);

  // Signed in with a personal link: link it to the account and open the app.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !g?.you || !memberToken || claimed.current) return;
    claimed.current = true;
    api
      .claimMember(token, memberToken)
      .then((r) => navigate(`/onsave/groups/${r.group_id}`, { replace: true }))
      .catch((err) => setError(err?.response?.status === 409 ? t("osLinkedElsewhere") : errorText(err)));
  }, [isLoaded, isSignedIn, g, memberToken, token, api, navigate, t]);

  // Signed in and already a member through the account: open the group in the app.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !g || g.you) return;
    api
      .myGroup(g.id)
      .then((mine) => navigate(`/onsave/groups/${mine.id}`, { replace: true }))
      .catch(() => {});
  }, [isLoaded, isSignedIn, g, api, navigate]);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const join = (e) => {
    e.preventDefault();
    run(async () => {
      if (isSignedIn) {
        const mine = await api.joinGroup(token, { name, phone });
        navigate(`/onsave/groups/${mine.id}`, { replace: true });
        return;
      }
      const r = await publicGroupApi.join(token, { name, phone });
      saveMember(token, r.member_token);
      setMemberToken(r.member_token);
      setG(r.group);
      setJoined(true);
    });
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

  const owner = g.owner_name || t("osOrganizer");
  const you = g.you;
  const round = currentRound(g);
  const mine = round && you ? paymentOf(round, you.id) : null;
  const yourRound = you && g.rounds.find((r) => r.recipient_id === you.id);
  const closed = g.status === "completed" || g.status === "cancelled";

  return page(
    <>
      <div className="bg-os-deep px-5 pb-[72px] text-white" style={{ paddingTop: "max(env(safe-area-inset-top), 24px)" }}>
        <div className="flex items-center justify-between">
          <Link to={isSignedIn ? "/onsave" : "/onsave/welcome"} className="flex items-center gap-2">
            <LogoMark size={26} />
            <Wordmark light className="text-base" />
          </Link>
          <LangSwitch className="border-os-deep-line bg-transparent" />
        </div>
        <p className="mt-6 text-sm text-os-deep-muted">{t("osInvitedBy", { owner })}</p>
        <h1 className="os-display mt-1 text-[30px] font-extrabold leading-tight tracking-tight">{g.name}</h1>
      </div>

      <div className="-mt-[52px] space-y-3.5 px-5 pb-10">
        <section className={cn(card, "grid grid-cols-3 p-4 text-center shadow-[0_12px_30px_rgba(36,26,79,0.10)]")}>
          <div>
            <p className="os-display text-xl font-extrabold">{money(g.amount_cents, g.currency, lang)}</p>
            <p className="mt-0.5 text-xs text-os-muted">{t("osEachRoundShort")}</p>
          </div>
          <div className="border-x border-os-line-soft px-1">
            <p className="os-display truncate text-xl font-extrabold">{t(`osFreqShort_${g.frequency}`)}</p>
            <p className="mt-0.5 text-xs text-os-muted">{t("osRoundsCount", { n: g.member_count })}</p>
          </div>
          <div>
            <p className="os-display text-xl font-extrabold text-os-money">{money(g.pot_cents, g.currency, lang)}</p>
            <p className="mt-0.5 text-xs text-os-muted">{t("osYourPot")}</p>
          </div>
        </section>

        {g.members.length > 0 && (
          <section className={cn(card, "flex items-center gap-3 rounded-2xl px-4 py-3.5")}>
            <AvatarStack names={g.members.map((m) => m.name)} max={4} size={32} />
            <p className="text-sm">
              <strong>{t("osJoinedLeft", { n: g.member_count })}</strong>
            </p>
          </section>
        )}

        {g.rules && <p className="whitespace-pre-wrap px-1 text-sm leading-relaxed text-os-muted">{g.rules}</p>}

        {you && yourRound && (
          <p className="rounded-2xl bg-os-brand-soft p-3.5 text-sm font-semibold text-os-brand-ink">
            {t("osYourTurn", { n: yourRound.number, date: formatDate(yourRound.date.slice(0, 10), lang, true) })}
          </p>
        )}

        {joined && (
          <section className={cn(card, "space-y-3 p-4")}>
            <p className="flex items-center gap-2 text-[15px] font-bold">
              <CheckCircle2 className="h-5 w-5 text-os-money" /> {t("osJoinedTitle")}
            </p>
            <p className="text-sm text-os-muted">{t("osJoinedBody")}</p>
            <Link to={authURL("sign-up")} className={cn(btnBrand, "w-full")}>
              {t("osGetApp")}
            </Link>
          </section>
        )}

        {g.status === "forming" && !you && (
          <form onSubmit={join} className={cn(card, "space-y-3 p-4")}>
            <h2 className="text-base font-bold">{t("osJoinTitle")}</h2>
            <label className="block">
              <span className={label}>{t("pubYourName")}</span>
              <input id="join-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={field} autoComplete="name" />
            </label>
            <label className="block">
              <span className={label}>{t("osWhatsapp")}</span>
              <input id="join-phone" type="tel" maxLength={24} placeholder="+1 416 555 0123" value={phone} onChange={(e) => setPhone(e.target.value)} className={field} autoComplete="tel" />
            </label>
            <ErrorNote>{error}</ErrorNote>
            <button disabled={busy} className={cn(btnBrand, "h-[54px] w-full text-base")}>
              {t("osJoinButton", { group: g.name })}
            </button>
          </form>
        )}

        {round && you && !isSignedIn && (
          <section className={cn(card, "space-y-3 p-4")}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-bold">{t("pubPayTitle", { n: round.number })}</h2>
              <span className="os-display text-lg font-bold">{money(g.amount_cents, g.currency, lang)}</span>
            </div>
            <p className="text-[13px] text-os-muted">
              {t("osTo", { name: round.recipient_name })} · {formatDate(round.date.slice(0, 10), lang)}
            </p>
            {mine?.status === "received" ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-os-money">
                <CheckCircle2 className="h-5 w-5" /> {t("osYouConfirmed", { owner })}
              </p>
            ) : mine?.status === "sent" ? (
              <p className="rounded-2xl bg-os-warn-soft px-3 py-2.5 text-sm text-os-warn">{t("osYouSent", { owner })}</p>
            ) : (
              <>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className={field} aria-label={t("osPayHow")}>
                  <option value="">{t("osPayHow")}</option>
                  {METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(async () => setG(await publicGroupApi.paid(token, memberToken, round.number, method)))}
                  className={cn(btnMoney, "w-full")}
                >
                  <Check className="h-[18px] w-[18px]" strokeWidth={2.6} /> {t("osIPaid")}
                </button>
              </>
            )}
            <ErrorNote>{error}</ErrorNote>
          </section>
        )}
        {g.status === "forming" && you && !joined && <p className={cn(card, "p-4 text-sm text-os-muted")}>{t("osWaitingStart", { owner })}</p>}
        {round && !you && <p className={cn(card, "p-4 text-sm text-os-muted")}>{t("osAskLink", { owner })}</p>}
        {isSignedIn && you && error && <ErrorNote>{error}</ErrorNote>}
        {closed && <p className={cn(card, "p-4 text-center text-sm")}>{t("pubGroupClosed")}</p>}

        {round && (
          <section className={cn(card, "px-4 pb-3 pt-1")}>
            <div className="flex items-center justify-between py-3">
              <h2 className="text-[15px] font-bold">{t("osRoundOf", { n: round.number, total: g.rounds.length })}</h2>
              <span className="text-[13px] text-os-muted">{t("osPaidOfTotal", { n: round.received_count + round.sent_count, total: g.member_count })}</span>
            </div>
            <ul className="divide-y divide-os-line-soft">
              {g.members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2">
                  <Avatar name={m.name} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {m.name} {you?.id === m.id && t("osYouSuffix")}
                  </span>
                  <PaymentChip payment={paymentOf(round, m.id)} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {g.rounds.length > 0 && (
          <section className={cn(card, "px-4 pb-2 pt-1")}>
            <h2 className="py-3 text-[15px] font-bold">{t("osSchedule")}</h2>
            <ol className="divide-y divide-os-line-soft">
              {g.rounds.map((r) => (
                <li key={r.number} className={cn("flex items-center gap-3 py-2.5 text-sm", r.number === g.current_round && g.status === "active" && "font-semibold")}>
                  <span className="w-14 shrink-0 text-os-muted">{t("osRoundShort", { n: r.number })}</span>
                  <span className="w-20 shrink-0">{formatDate(r.date.slice(0, 10), lang)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {r.recipient_name} {you?.id === r.recipient_id && t("osYouSuffix")}
                  </span>
                  {r.paid_out && <Check className="h-4 w-4 text-os-money" strokeWidth={2.6} aria-label="✓" />}
                </li>
              ))}
            </ol>
          </section>
        )}

        <p className="pt-2 text-center text-xs text-os-muted">{t("osNoAccount")}</p>
      </div>
    </>
  );
}
