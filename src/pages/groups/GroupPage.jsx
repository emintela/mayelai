import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp, BellRing, Check, Dices, Link2, Loader2, Megaphone, Trash2, UserPlus } from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { formatDate, formatMoney, groupLink, todayISO } from "@/lib/money";
import { cn } from "@/lib/utils";
import { AIDraftBox, Badge, Card, LangSwitch, SendButtons, inputCls, labelCls } from "@/pages/money/parts";
import { GroupStatus } from "./GroupsPage";

const small = "rounded-full border border-border px-3 py-1 text-xs font-medium transition hover:bg-accent disabled:opacity-50";

// Forming: members, order, invite link, start.
function Forming({ g, act }) {
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [start, setStart] = useState(todayISO());
  const ids = g.members.map((m) => m.id);
  const move = (i, d) => {
    const next = [...ids];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    act(() => api.groupAction(g.id, "order", { member_ids: next }));
  };
  const invite = t("inviteMessage", {
    name: g.name,
    amount: formatMoney(g.amount_cents, g.currency, lang),
    freq: t(`freq_${g.frequency}`).toLowerCase(),
    link: groupLink(g.share_token),
  });

  return (
    <>
      <Card className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold"><Link2 className="h-4 w-4 text-primary" /> {t("inviteTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("inviteBody")}</p>
        <p className="break-all rounded-xl bg-muted p-3 text-sm">{invite}</p>
        <SendButtons text={invite} />
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">{t("members")}</h2>
            <p className="text-xs text-muted-foreground">{t("membersBody")}</p>
          </div>
          <button
            disabled={g.members.length < 2}
            onClick={() => window.confirm(t("drawConfirm")) && act(() => api.groupAction(g.id, "draw"))}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            <Dices className="h-4 w-4" /> {t("drawLots")}
          </button>
        </div>
        <ol className="divide-y divide-border">
          {g.members.map((m, i) => (
            <li key={m.id} className="flex items-center gap-2 py-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{m.position}</span>
              <span className="min-w-0 flex-1 truncate">
                {m.name} {m.phone && <span className="text-xs text-muted-foreground">· {m.phone}</span>}
              </span>
              <button className={small} disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("moveUp")}><ArrowUp className="h-3.5 w-3.5" /></button>
              <button className={small} disabled={i === g.members.length - 1} onClick={() => move(i, 1)} aria-label={t("moveDown")}><ArrowDown className="h-3.5 w-3.5" /></button>
              <button className={cn(small, "text-rose-600")} aria-label={t("remove")} onClick={() => act(() => api.removeMember(g.id, m.id))}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ol>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(() => api.groupAction(g.id, "members", { name, phone })).then((ok) => ok && (setName(""), setPhone("")));
          }}
          className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        >
          <input required maxLength={80} placeholder={t("memberName")} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} aria-label={t("memberName")} />
          <input type="tel" maxLength={24} placeholder="+243 / +1 …" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} aria-label={t("theirPhone")} />
          <button className="inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            <UserPlus className="h-4 w-4" /> {t("addMember")}
          </button>
        </form>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">{t("startTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("startBody")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className={labelCls} htmlFor="start">{t("firstRound")}</label>
            <input id="start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
          </div>
          <button
            disabled={g.members.length < 2}
            onClick={() => act(() => api.groupAction(g.id, "start", { start_date: start, today: todayISO() }))}
            className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {t("start")}
          </button>
        </div>
      </Card>
    </>
  );
}

function MemberLinkButton({ g, m }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const text = t("personalLinkMessage", { name: m.name, group: g.name, link: groupLink(g.share_token, m.member_token) });
  return (
    <>
      <button className={small} onClick={() => setOpen((o) => !o)}>
        <Link2 className="mr-1 inline h-3 w-3" /> {t("personalLink")}
      </button>
      {open && (
        <div className="w-full">
          <SendButtons phone={m.phone} text={text} />
        </div>
      )}
    </>
  );
}

// Running: current round payments, payout, reminders, schedule.
function Running({ g, act }) {
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const [reminding, setReminding] = useState(null);
  const done = g.status === "completed";
  const round = done ? null : g.rounds[g.current_round - 1];
  const pot = formatMoney(g.pot_cents, g.currency, lang);
  const statusOf = (r, memberId) => r.payments.find((p) => p.member_id === memberId);

  return (
    <>
      {round ? (
        <Card className="space-y-3">
          <div>
            <p className="text-sm text-muted-foreground">
              {t("roundOf", { n: round.number, total: g.rounds.length })} · {formatDate(round.date.slice(0, 10), lang)}
            </p>
            <h2 className="text-xl font-bold">{t("receives", { name: round.recipient_name, pot })}</h2>
            <p className="text-sm">{t("paidCount", { n: round.received_count + round.sent_count, total: g.member_count })}</p>
          </div>
          <ul className="divide-y divide-border">
            {g.members.map((m) => {
              const p = statusOf(round, m.id);
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                  {p?.status === "received" ? (
                    <Badge tone="green">✓ {t("receivedStatus")}</Badge>
                  ) : p?.status === "sent" ? (
                    <Badge tone="amber">{t("sentStatus")}{p.method && ` · ${p.method}`}</Badge>
                  ) : (
                    <Badge tone="gray">{t("notPaid")}</Badge>
                  )}
                  {p?.status !== "received" && (
                    <button
                      className={cn(small, "border-emerald-600/40 text-emerald-700")}
                      onClick={() => act(() => api.groupAction(g.id, "payments", { member_id: m.id, round: round.number, status: "received", method: p?.method || "" }))}
                    >
                      <Check className="mr-0.5 inline h-3 w-3" /> {t("markReceived")}
                    </button>
                  )}
                  {p && (
                    <button className={small} onClick={() => act(() => api.groupAction(g.id, "payments", { member_id: m.id, round: round.number, status: "none", method: "" }))}>
                      {t("undo")}
                    </button>
                  )}
                  {!p && (
                    <button className={small} onClick={() => setReminding(reminding === m.id ? null : m.id)}>
                      <BellRing className="mr-1 inline h-3 w-3" /> {t("remind")}
                    </button>
                  )}
                  <MemberLinkButton g={g} m={m} />
                  {reminding === m.id && (
                    <div className="w-full">
                      <AIDraftBox
                        fetchDraft={(language) => api.groupAction(g.id, "draft", { purpose: "reminder", language, member_id: m.id })}
                        link={groupLink(g.share_token, m.member_token)}
                        phone={m.phone}
                        onClose={() => setReminding(null)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <button
            onClick={() => act(() => api.groupAction(g.id, "payouts", { round: round.number, paid: true }))}
            className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t("potHanded", { name: round.recipient_name })}
          </button>
        </Card>
      ) : (
        <Card><p className="text-center font-medium">{t("groupDone")}</p></Card>
      )}

      {round && (
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 font-semibold"><Megaphone className="h-4 w-4 text-primary" /> {t("roundUpdate")}</h2>
          <p className="text-sm text-muted-foreground">{t("roundUpdateBody")}</p>
          <AIDraftBox
            fetchDraft={(language) => api.groupAction(g.id, "draft", { purpose: "update", language })}
            link={groupLink(g.share_token)}
          />
        </Card>
      )}

      <Card className="space-y-2">
        <h2 className="font-semibold">{t("schedule")}</h2>
        <ol className="divide-y divide-border">
          {g.rounds.map((r) => (
            <li key={r.number} className={cn("flex flex-wrap items-center gap-2 py-2 text-sm", r.number === g.current_round && "font-semibold")}>
              <span className="w-16 shrink-0 text-muted-foreground">{t("roundN", { n: r.number })}</span>
              <span className="w-24 shrink-0">{formatDate(r.date.slice(0, 10), lang)}</span>
              <span className="min-w-0 flex-1 truncate">{r.recipient_name}</span>
              <span className="text-xs text-muted-foreground">{t("paidCount", { n: r.received_count + r.sent_count, total: g.member_count })}</span>
              {r.paid_out ? (
                <button className={small} title={t("undo")} onClick={() => act(() => api.groupAction(g.id, "payouts", { round: r.number, paid: false }))}>
                  {t("potHandedDone")}
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}

export default function GroupPage() {
  const { id } = useParams();
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const [g, setG] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.getGroup(id).then(setG).catch((e) => setError(e?.response?.status === 404 ? "Not found." : errorText(e)));
  }, [api, id]);
  useEffect(load, [load]);

  // Runs an action that returns the updated group; resolves true on success.
  const act = async (fn) => {
    setActionError(null);
    setBusy(true);
    try {
      setG(await fn());
      return true;
    } catch (err) {
      setActionError(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (error)
    return (
      <div className="mx-auto max-w-xl px-4 py-10 text-center">
        <p className="text-muted-foreground">{error}</p>
        <Link to="/likelemba" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">{t("back")}</Link>
      </div>
    );
  if (!g) return <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  const btn = "rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent";
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6 lg:px-8">
      <div className="flex items-center justify-between">
        <Link to="/likelemba" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {t("back")}
        </Link>
        <LangSwitch />
      </div>

      <Card className="space-y-2">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <GroupStatus status={g.status} /> {t(`freq_${g.frequency}`)} · {t("membersCount", { n: g.member_count })}
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        </p>
        <h1 className="text-2xl font-bold">{g.name}</h1>
        <p className="text-sm">
          {t("perRound", { amount: formatMoney(g.amount_cents, g.currency, lang), pot: formatMoney(g.pot_cents, g.currency, lang) })}
        </p>
        {g.rules && <p className="whitespace-pre-wrap rounded-xl bg-muted p-3 text-sm">{g.rules}</p>}
      </Card>

      {actionError && <p role="alert" className="text-sm text-rose-600">{actionError}</p>}

      {g.status === "forming" && <Forming g={g} act={act} />}
      {(g.status === "active" || g.status === "completed") && <Running g={g} act={act} />}

      <Card className="flex flex-wrap gap-2">
        {(g.status === "forming" || g.status === "active") && (
          <button className={btn} onClick={() => window.confirm(t("cancelGroupConfirm")) && act(() => api.groupAction(g.id, "cancel"))}>
            {t("cancelGroup")}
          </button>
        )}
        <button
          className={cn(btn, "ml-auto border-rose-500/40 text-rose-600 hover:bg-rose-500/10")}
          onClick={async () => {
            if (!window.confirm(t("deleteGroupConfirm"))) return;
            try {
              await api.deleteGroup(g.id);
              navigate("/likelemba", { replace: true });
            } catch (err) {
              setActionError(errorText(err));
            }
          }}
        >
          {t("deleteLoan")}
        </button>
      </Card>
      <p className="text-center text-xs text-muted-foreground">{t("noMoneyHandled")}</p>
    </div>
  );
}
