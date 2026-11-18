import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Dices,
  Link2,
  Megaphone,
  MessageCircle,
  MessageSquareText,
  MoreHorizontal,
  PartyPopper,
  Share2,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { formatDate, groupLink, smsURL, todayISO, whatsappURL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { AIDraftBox } from "@/pages/money/parts";
import {
  Avatar,
  ErrorNote,
  GroupChip,
  PaymentChip,
  Ring,
  Spinner,
  TopBar,
  btnBrand,
  btnGhost,
  btnMoney,
  card,
  currentRound,
  field,
  iconBtn,
  label,
  money,
  paymentOf,
  smallBtn,
} from "./ui";

// WhatsApp / SMS / share-or-copy for a ready-made message.
export function ShareButtons({ text, phone }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        /* cancelled or not allowed: fall back to copying */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <a href={whatsappURL(phone, text)} target="_blank" rel="noopener noreferrer" className={cn(smallBtn, "border-transparent bg-[#1f8f5f] px-4 text-white hover:bg-[#187a50]")}>
        <MessageCircle className="h-4 w-4" /> WhatsApp
      </a>
      <a href={smsURL(phone, text)} className={cn(smallBtn, "px-4")}>
        <MessageSquareText className="h-4 w-4" /> SMS
      </a>
      <button type="button" onClick={share} className={cn(smallBtn, "px-4")}>
        {copied ? <Check className="h-4 w-4 text-os-money" /> : navigator.share ? <Share2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? t("copied") : navigator.share ? t("osShare") : t("copy")}
      </button>
    </div>
  );
}

const nameWithYou = (m, g, t) => (g.you?.id === m.id ? `${m.name} ${t("osYouSuffix")}` : m.name);

// ---------- forming ----------

function Forming({ g, act, created }) {
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [start, setStart] = useState(todayISO());
  const organizer = g.role === "organizer";
  const ids = g.members.map((m) => m.id);
  const move = (i, d) => {
    const next = [...ids];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    act(() => api.groupAction(g.id, "order", { member_ids: next }));
  };
  const invite = organizer
    ? t("inviteMessage", { name: g.name, amount: money(g.amount_cents, g.currency, lang), freq: t(`osFreq_${g.frequency}`), link: groupLink(g.share_token) })
    : "";

  return (
    <>
      {organizer && (
        <section id="invite" className={cn(card, "space-y-3 p-4", created && "border-os-brand ring-2 ring-os-brand/20")}>
          <h2 className="flex items-center gap-2 text-[15px] font-bold">
            <Link2 className="h-4 w-4 text-os-brand" /> {t("osInviteTitle")}
          </h2>
          <p className="text-[13px] text-os-muted">{created ? t("osCreatedNote") : t("osInviteBody")}</p>
          <p className="break-all rounded-2xl bg-os-bg p-3 text-sm">{invite}</p>
          <ShareButtons text={invite} />
        </section>
      )}
      {!organizer && <p className={cn(card, "p-4 text-sm text-os-muted")}>{t("osWaitingStart", { owner: g.owner_name || t("osOrganizer") })}</p>}

      <section className={cn(card, "space-y-3 p-4")}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold">{t("osMembersOrder")}</h2>
            <p className="text-xs text-os-muted">{t("osMembersOrderBody")}</p>
          </div>
          {organizer && (
            <button
              type="button"
              disabled={g.members.length < 2}
              onClick={() => window.confirm(t("drawConfirm")) && act(() => api.groupAction(g.id, "draw"))}
              className={smallBtn}
            >
              <Dices className="h-4 w-4" /> {t("osDraw")}
            </button>
          )}
        </div>
        <ol className="divide-y divide-os-line-soft">
          {g.members.map((m, i) => (
            <li key={m.id} className="flex items-center gap-3 py-2">
              <span className="w-5 text-center text-sm font-semibold text-os-muted">{m.position}</span>
              <Avatar name={m.name} size={32} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {nameWithYou(m, g, t)}
                {organizer && m.phone && <span className="block truncate text-xs font-normal text-os-muted">{m.phone}</span>}
              </span>
              {organizer && (
                <div className="flex gap-1">
                  <button type="button" className={cn(smallBtn, "w-9 justify-center px-0")} disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("osMoveUp")}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className={cn(smallBtn, "w-9 justify-center px-0")}
                    disabled={i === g.members.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={t("osMoveDown")}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className={cn(smallBtn, "w-9 justify-center px-0 text-os-danger")}
                    onClick={() => window.confirm(`${t("osRemove")} — ${m.name}?`) && act(() => api.removeMember(g.id, m.id))}
                    aria-label={`${t("osRemove")} ${m.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
        {organizer && (
          <details className="rounded-2xl border border-dashed border-os-line p-3">
            <summary className="cursor-pointer text-sm font-semibold">{t("osAddSomeone")}</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                act(() => api.groupAction(g.id, "members", { name, phone })).then((ok) => ok && (setName(""), setPhone("")));
              }}
              className="mt-3 space-y-2"
            >
              <label className="block">
                <span className={label}>{t("osName")}</span>
                <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={field} />
              </label>
              <label className="block">
                <span className={label}>{t("osPhoneOptional")}</span>
                <input type="tel" maxLength={24} placeholder="+243 / +1 …" value={phone} onChange={(e) => setPhone(e.target.value)} className={field} />
              </label>
              <button className={cn(btnBrand, "w-full")}>
                <UserPlus className="h-4 w-4" /> {t("osAdd")}
              </button>
            </form>
          </details>
        )}
      </section>

      {organizer && (
        <section className={cn(card, "space-y-3 p-4")}>
          <h2 className="text-[15px] font-bold">{t("osStartTitle")}</h2>
          <p className="text-[13px] text-os-muted">{t("osStartBody")}</p>
          <label className="block">
            <span className={label}>{t("osFirstRound")}</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={field} />
          </label>
          <button
            type="button"
            disabled={g.members.length < 2}
            onClick={() => act(() => api.groupAction(g.id, "start", { start_date: start, today: todayISO() }))}
            className={cn(btnBrand, "w-full")}
          >
            {t("osStart")}
          </button>
          {g.members.length < 2 && <p className="text-center text-xs text-os-muted">{t("osNeedTwo")}</p>}
        </section>
      )}
    </>
  );
}

// ---------- running ----------

function MemberRow({ g, m, round, act, open, onToggle }) {
  const api = useApi();
  const t = useT();
  const [reminding, setReminding] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const p = paymentOf(round, m.id);
  const organizer = g.role === "organizer";
  const setPayment = (status) => act(() => api.groupAction(g.id, "payments", { member_id: m.id, round: round.number, status, method: p?.method || "" }));
  const personal = organizer ? t("personalLinkMessage", { name: m.name, group: g.name, link: groupLink(g.share_token, m.member_token) }) : "";

  const head = (
    <>
      <Avatar name={m.name} size={32} />
      <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">
        {nameWithYou(m, g, t)}
        {p?.status === "sent" && p.method && <span className="block truncate text-xs font-normal text-os-muted">{p.method}</span>}
      </span>
      <PaymentChip payment={p} />
    </>
  );
  if (!organizer) return <li className="flex items-center gap-3 py-2">{head}</li>;
  return (
    <li className="py-1">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 rounded-xl py-1.5 transition hover:bg-os-line-soft/60">
        {head}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-os-muted transition", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div className="space-y-2 pb-2 pl-11 pt-1">
          <div className="flex flex-wrap gap-1.5">
            {p?.status !== "received" && (
              <button type="button" className={cn(smallBtn, "border-os-money/40 text-os-money")} onClick={() => setPayment("received")}>
                <Check className="h-3.5 w-3.5" /> {t("osConfirm")}
              </button>
            )}
            {p && (
              <button type="button" className={smallBtn} onClick={() => setPayment("none")}>
                {t("undo")}
              </button>
            )}
            {!p && (
              <button type="button" className={smallBtn} onClick={() => setReminding((r) => !r)}>
                <Bell className="h-3.5 w-3.5" /> {t("remind")}
              </button>
            )}
            <button type="button" className={smallBtn} onClick={() => setLinkOpen((o) => !o)}>
              <Link2 className="h-3.5 w-3.5" /> {t("osPersonalLink")}
            </button>
          </div>
          {linkOpen && <ShareButtons text={personal} phone={m.phone} />}
          {reminding && (
            <AIDraftBox
              fetchDraft={(language) => api.groupAction(g.id, "draft", { purpose: "reminder", language, member_id: m.id })}
              link={groupLink(g.share_token, m.member_token)}
              phone={m.phone}
              onClose={() => setReminding(false)}
            />
          )}
        </div>
      )}
    </li>
  );
}

function Running({ g, act }) {
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const [openRow, setOpenRow] = useState(null);
  const [composer, setComposer] = useState(false);
  const organizer = g.role === "organizer";
  const round = currentRound(g);
  const owner = g.owner_name || t("osOrganizer");

  if (g.status === "completed" || g.status === "cancelled") {
    const done = g.status === "completed";
    return (
      <section className={cn(card, "flex flex-col items-center gap-2 p-6 text-center")}>
        {done ? <PartyPopper className="h-10 w-10 text-os-brand" aria-hidden="true" /> : <X className="h-10 w-10 text-os-muted" aria-hidden="true" />}
        <p className="os-display text-xl font-extrabold">{done ? t("osFinishedTitle") : t("osStatus_cancelled")}</p>
        <p className="text-sm text-os-muted">{done ? t("osFinishedBody") : t("osCancelledBody")}</p>
      </section>
    );
  }
  if (!round) return null;

  const paid = round.received_count + round.sent_count;
  const unpaid = g.members.filter((m) => !paymentOf(round, m.id));
  const mine = g.you ? paymentOf(round, g.you.id) : null;
  const youReceive = g.you?.id === round.recipient_id;

  return (
    <>
      <section className={cn(card, "flex items-center gap-5 p-4")}>
        <Ring value={paid} total={g.member_count} size={120}>
          <span className="os-display max-w-[84px] text-lg font-extrabold leading-none">{money(paid * g.amount_cents, g.currency, lang)}</span>
          <span className="mt-1 text-xs text-os-muted">{t("osOf", { pot: money(g.pot_cents, g.currency, lang) })}</span>
        </Ring>
        <div className="min-w-0 space-y-2">
          <span className="inline-flex rounded-full bg-os-brand-soft px-2.5 py-1 text-xs font-semibold text-os-brand-ink">
            {t("osRoundOf", { n: round.number, total: g.rounds.length })}
          </span>
          <p className="text-[15px] font-semibold leading-snug">{youReceive ? t("osYouReceivePot") : t("osReceivesPot", { name: round.recipient_name })}</p>
          <p className="text-[13px] text-os-muted">{formatDate(round.date.slice(0, 10), lang, true)}</p>
        </div>
      </section>

      {g.you && (
        <section className={cn(card, "space-y-3 p-4")}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-bold">{t("osYourPayment")}</h2>
            <span className="os-display text-lg font-bold">{money(g.amount_cents, g.currency, lang)}</span>
          </div>
          {mine?.status === "received" ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-os-money">
              <CheckCircle2 className="h-5 w-5" /> {t("osYouConfirmed", { owner })}
            </p>
          ) : mine?.status === "sent" ? (
            <p className="rounded-2xl bg-os-warn-soft px-3 py-2.5 text-sm text-os-warn">{t("osYouSent", { owner })}</p>
          ) : (
            <Link to={`/onsave/groups/${g.id}/pay`} className={cn(btnMoney, "w-full")}>
              <Check className="h-[18px] w-[18px]" strokeWidth={2.6} /> {t("osIPaid")}
            </Link>
          )}
        </section>
      )}

      <section className={cn(card, "px-4 pb-3 pt-1")}>
        <div className="flex items-center justify-between py-3">
          <h2 className="text-[15px] font-bold">{t("osThisRound")}</h2>
          <span className="text-[13px] text-os-muted">{t("osPaidOfTotal", { n: paid, total: g.member_count })}</span>
        </div>
        <ul className="divide-y divide-os-line-soft">
          {g.members.map((m) => (
            <MemberRow
              key={m.id}
              g={g}
              m={m}
              round={round}
              act={act}
              open={openRow === m.id}
              onToggle={() => setOpenRow((o) => (o === m.id ? null : m.id))}
            />
          ))}
        </ul>
      </section>

      {organizer && (
        <div className="space-y-2.5">
          {unpaid.length > 0 && (
            <button type="button" className={cn(btnBrand, "w-full")} onClick={() => setOpenRow(unpaid[0].id)}>
              <Bell className="h-[18px] w-[18px]" /> {unpaid.length === 1 ? t("osRemindOne") : t("osRemindN", { n: unpaid.length })}
            </button>
          )}
          <button
            type="button"
            className={cn(btnGhost, "w-full")}
            onClick={() =>
              window.confirm(t("osHandOverConfirm", { n: round.number, name: round.recipient_name })) &&
              act(() => api.groupAction(g.id, "payouts", { round: round.number, paid: true }))
            }
          >
            <CheckCircle2 className="h-[18px] w-[18px] text-os-money" /> {t("osHandOver", { name: round.recipient_name })}
          </button>
          <section className={cn(card, "space-y-3 p-4")}>
            <button type="button" onClick={() => setComposer((c) => !c)} aria-expanded={composer} className="flex w-full items-center gap-2 text-left">
              <Megaphone className="h-4 w-4 text-os-brand" />
              <span className="flex-1 text-[15px] font-bold">{t("osMessageGroup")}</span>
              <ChevronDown className={cn("h-4 w-4 text-os-muted transition", composer && "rotate-180")} />
            </button>
            {composer && (
              <>
                <p className="text-[13px] text-os-muted">{t("osMessageGroupBody")}</p>
                <AIDraftBox fetchDraft={(language) => api.groupAction(g.id, "draft", { purpose: "update", language })} link={groupLink(g.share_token)} />
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function Schedule({ g, act }) {
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const organizer = g.role === "organizer";
  return (
    <section className={cn(card, "px-4 pb-2 pt-1")}>
      <h2 className="py-3 text-[15px] font-bold">{t("osSchedule")}</h2>
      <ol className="divide-y divide-os-line-soft">
        {g.rounds.map((r) => {
          const current = g.status === "active" && r.number === g.current_round;
          return (
            <li key={r.number} className={cn("flex items-center gap-3 py-2.5 text-sm", current && "font-semibold")}>
              <span className={cn("w-14 shrink-0", current ? "text-os-brand" : "text-os-muted")}>{t("osRoundShort", { n: r.number })}</span>
              <span className="w-20 shrink-0">{formatDate(r.date.slice(0, 10), lang)}</span>
              <span className="min-w-0 flex-1 truncate">{g.you?.id === r.recipient_id ? `${r.recipient_name} ${t("osYouSuffix")}` : r.recipient_name}</span>
              {r.paid_out &&
                (organizer ? (
                  <button
                    type="button"
                    title={t("undo")}
                    onClick={() => window.confirm(t("osPaidOutUndo", { n: r.number })) && act(() => api.groupAction(g.id, "payouts", { round: r.number, paid: false }))}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-os-money-soft text-os-money"
                    aria-label={t("osPaidOutUndo", { n: r.number })}
                  >
                    <Check className="h-4 w-4" strokeWidth={2.6} />
                  </button>
                ) : (
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-os-money-soft text-os-money">
                    <Check className="h-4 w-4" strokeWidth={2.6} aria-hidden="true" />
                  </span>
                ))}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function MoreMenu({ g, act, onDeleted, onError }) {
  const api = useApi();
  const t = useT();
  const [open, setOpen] = useState(false);
  const item = "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium hover:bg-os-line-soft";
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t("osMore")} className={iconBtn}>
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-10 w-52 rounded-2xl border border-os-line bg-os-card p-1.5 shadow-xl">
          {(g.status === "forming" || g.status === "active") && (
            <button
              type="button"
              className={item}
              onClick={() => {
                setOpen(false);
                window.confirm(t("cancelGroupConfirm")) && act(() => api.groupAction(g.id, "cancel"));
              }}
            >
              <X className="h-4 w-4" /> {t("osCancelGroup")}
            </button>
          )}
          <button
            type="button"
            className={cn(item, "text-os-danger")}
            onClick={async () => {
              setOpen(false);
              if (!window.confirm(t("deleteGroupConfirm"))) return;
              try {
                await api.deleteGroup(g.id);
                onDeleted();
              } catch (err) {
                onError(errorText(err));
              }
            }}
          >
            <Trash2 className="h-4 w-4" /> {t("osDeleteGroup")}
          </button>
        </div>
      )}
    </div>
  );
}

export default function GroupDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const [g, setG] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(() => {
    api.myGroup(id).then(setG).catch((e) => setError(e?.response?.status === 404 ? t("osNotFound") : errorText(e)));
  }, [api, id, t]);
  useEffect(load, [load]);

  // Organizer actions return the organizer view; keep this person's role and membership.
  const act = async (fn) => {
    setActionError(null);
    try {
      const res = await fn();
      setG((prev) => ({ ...res, role: prev.role, you: res.members.find((m) => m.id === prev.you?.id) ?? null }));
      return true;
    } catch (err) {
      setActionError(errorText(err));
      return false;
    }
  };

  if (error)
    return (
      <div className="space-y-4 pt-2">
        <TopBar back="/onsave/groups" />
        <p className="py-10 text-center text-sm text-os-muted">{error}</p>
      </div>
    );
  if (!g) return <Spinner />;

  const organizer = g.role === "organizer";
  return (
    <div className="space-y-4 pt-2">
      <TopBar back="/onsave/groups">
        {organizer && g.status === "forming" && (
          <a href="#invite" className={cn(smallBtn, "min-h-11 px-4 text-sm")}>
            <Share2 className="h-4 w-4" /> {t("osShare")}
          </a>
        )}
        {organizer && <MoreMenu g={g} act={act} onDeleted={() => navigate("/onsave/groups", { replace: true })} onError={setActionError} />}
      </TopBar>

      <div>
        <div className="mb-1 flex items-center gap-2">
          <GroupChip status={g.status} />
          {!organizer && <span className="truncate text-xs text-os-muted">{t("osOrganizedBy", { owner: g.owner_name || "—" })}</span>}
        </div>
        <h1 className="os-display text-[26px] font-extrabold leading-tight">{g.name}</h1>
        <p className="mt-1 text-sm text-os-muted">
          {t("osGroupLine", { amount: money(g.amount_cents, g.currency, lang), freq: t(`osFreq_${g.frequency}`), n: g.member_count })}
        </p>
      </div>

      <ErrorNote>{actionError}</ErrorNote>

      {g.status === "forming" ? <Forming g={g} act={act} created={params.get("created") === "1"} /> : <Running g={g} act={act} />}

      {g.rules && (
        <section className={cn(card, "space-y-1.5 p-4")}>
          <h2 className="text-[13px] font-semibold text-os-muted">{t("osRules")}</h2>
          <p className="whitespace-pre-wrap text-sm">{g.rules}</p>
        </section>
      )}

      {g.rounds.length > 0 && <Schedule g={g} act={act} />}

      <p className="px-4 text-center text-xs text-os-muted">{t("noMoneyHandled")}</p>
    </div>
  );
}
