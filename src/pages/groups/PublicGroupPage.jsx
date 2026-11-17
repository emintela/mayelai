import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { errorText, publicGroupApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { METHODS, formatDate, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge, LangSwitch, inputCls, labelCls } from "@/pages/money/parts";
import { GroupStatus } from "./GroupsPage";

// The member's personal token is kept on this device only (from ?m= or after joining).
const keyFor = (token) => `mayelai.member.${token}`;
const readMember = (token) => {
  try {
    return localStorage.getItem(keyFor(token)) || "";
  } catch {
    return "";
  }
};
const saveMember = (token, memberToken) => {
  try {
    localStorage.setItem(keyFor(token), memberToken);
  } catch {
    /* storage blocked: works for this visit only */
  }
};

export default function PublicGroupPage() {
  const { token } = useParams();
  const [params, setParams] = useSearchParams();
  const t = useT();
  const lang = useLang();
  const [memberToken, setMemberToken] = useState(() => params.get("m") || readMember(token));
  const [g, setG] = useState(null);
  const [state, setState] = useState("loading");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [joined, setJoined] = useState(false);

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
      const r = await publicGroupApi.join(token, { name, phone });
      saveMember(token, r.member_token);
      setMemberToken(r.member_token);
      setG(r.group);
      setJoined(true);
    });
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
      <p className="mt-6 max-w-lg text-center text-xs text-muted-foreground">{t("pubFooterGroup")}</p>
    </div>
  );
  const card = "rounded-2xl border border-border bg-card p-5 shadow-sm";

  if (state === "loading") return shell(<Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />);
  if (state !== "ready") return shell(<p className={cn(card, "text-center")}>{state === "notfound" ? t("pubNotFound") : errorText()}</p>);

  const you = g.you;
  const round = g.status === "active" ? g.rounds[g.current_round - 1] : null;
  const yourPayment = round && you ? round.payments.find((p) => p.member_id === you.id) : null;
  const yourRound = you && g.rounds.find((r) => r.recipient_id === you.id);
  const nameOf = (id) => g.members.find((m) => m.id === id)?.name ?? "";

  return shell(
    <>
      <section className={cn(card, "space-y-2")}>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <GroupStatus status={g.status} /> {t(`freq_${g.frequency}`)} · {t("membersCount", { n: g.member_count })}
        </p>
        <h1 className="text-2xl font-bold">{g.name}</h1>
        <p className="text-sm">
          {t("perRound", { amount: formatMoney(g.amount_cents, g.currency, lang), pot: formatMoney(g.pot_cents, g.currency, lang) })} ·{" "}
          {t("pubOrganizedBy", { owner: g.owner_name || "Mayel'AI" })}
        </p>
        {g.rules && <p className="whitespace-pre-wrap rounded-xl bg-muted p-3 text-sm">{g.rules}</p>}
        {you && yourRound && (
          <p className="rounded-xl bg-primary/10 p-3 text-sm font-medium text-primary">
            {t("pubYourTurn", { n: yourRound.number, date: formatDate(yourRound.date.slice(0, 10), lang, true) })}
          </p>
        )}
      </section>

      {joined && <p className={cn(card, "flex items-center gap-2 font-medium")}><CheckCircle2 className="h-5 w-5 text-emerald-600" /> {t("pubJoined")}</p>}

      {g.status === "forming" && !you && (
        <form onSubmit={join} className={cn(card, "space-y-3")}>
          <h2 className="font-semibold">{t("pubJoinTitle")}</h2>
          <div>
            <label className={labelCls} htmlFor="name">{t("pubYourName")}</label>
            <input id="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="phone">{t("pubYourPhone")}</label>
            <input id="phone" type="tel" maxLength={24} value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
          </div>
          {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
          <button disabled={busy} className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("pubJoin")}
          </button>
        </form>
      )}
      {g.status === "forming" && <p className={cn(card, "text-sm text-muted-foreground")}>{t("pubNotStarted")}</p>}

      {round && you && (
        <section className={cn(card, "space-y-3")}>
          <h2 className="font-semibold">{t("pubPayTitle", { n: round.number })}</h2>
          <p className="text-sm text-muted-foreground">
            {formatDate(round.date.slice(0, 10), lang, true)} · {t("receives", { name: round.recipient_name, pot: formatMoney(g.pot_cents, g.currency, lang) })}
          </p>
          {yourPayment?.status === "received" ? (
            <p className="font-medium text-emerald-700">{t("pubYouReceived")}</p>
          ) : yourPayment?.status === "sent" ? (
            <p className="text-sm text-amber-700">{t("pubYouSent")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={cn(inputCls, "w-auto")} aria-label={t("method")}>
                <option value="">{t("method")}…</option>
                {METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
              <button
                disabled={busy}
                onClick={() => run(async () => setG(await publicGroupApi.paid(token, memberToken, round.number, method)))}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {t("pubIPaid")}
              </button>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        </section>
      )}
      {round && !you && <p className={cn(card, "text-sm text-muted-foreground")}>{t("pubAskLink")}</p>}
      {(g.status === "completed" || g.status === "cancelled") && <p className={cn(card, "text-center")}>{t("pubGroupClosed")}</p>}

      {round && (
        <section className={card}>
          <h2 className="font-semibold">{t("roundOf", { n: round.number, total: g.rounds.length })}</h2>
          <p className="text-sm text-muted-foreground">{t("paidCount", { n: round.received_count + round.sent_count, total: g.member_count })}</p>
          <ul className="mt-2 divide-y divide-border">
            {g.members.map((m) => {
              const p = round.payments.find((x) => x.member_id === m.id);
              return (
                <li key={m.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="flex-1">{m.name}{you?.id === m.id && ` (${t("pubYou").toLowerCase()})`}</span>
                  {p?.status === "received" ? <Badge tone="green">✓ {t("receivedStatus")}</Badge> : p?.status === "sent" ? <Badge tone="amber">{t("sentStatus")}</Badge> : <Badge tone="gray">{t("notPaid")}</Badge>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className={card}>
        <h2 className="font-semibold">{g.status === "forming" ? t("members") : t("schedule")}</h2>
        <ol className="mt-2 divide-y divide-border">
          {g.status === "forming"
            ? g.members.map((m) => (
                <li key={m.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="w-6 text-muted-foreground">{m.position}.</span>
                  <span className="flex-1">{m.name}{you?.id === m.id && ` (${t("pubYou").toLowerCase()})`}</span>
                </li>
              ))
            : g.rounds.map((r) => (
                <li key={r.number} className={cn("flex items-center gap-2 py-2 text-sm", r.number === g.current_round && "font-semibold")}>
                  <span className="w-16 shrink-0 text-muted-foreground">{t("roundN", { n: r.number })}</span>
                  <span className="w-28 shrink-0">{formatDate(r.date.slice(0, 10), lang)}</span>
                  <span className="flex-1 truncate">{nameOf(r.recipient_id)}{you?.id === r.recipient_id && ` (${t("pubYou").toLowerCase()})`}</span>
                  {r.paid_out && <Badge tone="green">✓</Badge>}
                </li>
              ))}
        </ol>
      </section>
    </>
  );
}
