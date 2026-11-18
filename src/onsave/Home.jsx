import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { Bell, Check, CheckCircle2, ChevronRight, HandCoins, HeartHandshake, Plus, RefreshCw } from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { formatDate } from "@/lib/money";
import { cn } from "@/lib/utils";
import { lastSeenActivity } from "./Activity";
import {
  Avatar,
  AvatarStack,
  Chip,
  ErrorNote,
  GroupChip,
  LinkCard,
  Spinner,
  btnMoney,
  card,
  dueItems,
  dueText,
  iconBtn,
  money,
  nextPayout,
  toConfirm,
} from "./ui";

export function GroupRow({ g }) {
  const t = useT();
  const lang = useLang();
  return (
    <LinkCard to={`/onsave/groups/${g.id}`} className="flex items-center gap-3 rounded-2xl px-3.5 py-3">
      <AvatarStack names={g.members.map((m) => m.name)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{g.name}</p>
        <p className="truncate text-xs text-os-muted">
          {t("osGroupLine", { amount: money(g.amount_cents, g.currency, lang), freq: t(`osFreq_${g.frequency}`), n: g.member_count })}
        </p>
      </div>
      <GroupChip status={g.status} />
    </LinkCard>
  );
}

function Hero({ groups }) {
  const t = useT();
  const lang = useLang();
  const next = nextPayout(groups);
  if (next) {
    const { g, r } = next;
    const done = g.rounds.filter((x) => x.paid_out).length;
    return (
      <Link to={`/onsave/groups/${g.id}`} className="relative block overflow-hidden rounded-[28px] bg-os-deep p-5 text-white transition active:scale-[0.99]">
        <svg width="200" height="200" viewBox="0 0 200 200" aria-hidden="true" className="absolute -right-14 -top-12 opacity-35">
          <circle cx="100" cy="100" r="70" fill="none" stroke="#8c76f0" strokeWidth="2" strokeDasharray="4 10" />
          {[[100, 30], [161, 65], [100, 170], [39, 135], [39, 65]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="9" fill="#8c76f0" />
          ))}
          <circle cx="161" cy="135" r="9" fill="#3fc48e" />
        </svg>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-os-deep-muted">{t("osNextPayout")}</p>
        <p className="os-display mt-2 text-[40px] font-extrabold leading-none tracking-tight">{money(g.pot_cents, g.currency, lang)}</p>
        <p className="mt-2 text-sm text-[#e4defa]">
          {g.name} · {t("osRoundShort", { n: r.number })} · {formatDate(r.date.slice(0, 10), lang)}
        </p>
        <div className="mt-5 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-os-mint" style={{ width: `${(done / g.rounds.length) * 100}%` }} />
          </div>
          <span className="text-xs font-semibold text-[#e4defa]">{t("osRoundsDone", { n: done, total: g.rounds.length })}</span>
        </div>
      </Link>
    );
  }
  const live = groups.some((g) => g.status === "active" || g.status === "forming");
  return (
    <section className="relative overflow-hidden rounded-[28px] bg-os-deep p-5 text-white">
      <p className="os-display text-2xl font-extrabold leading-tight">{live ? t("osRunning") : t("osEmptyTitle")}</p>
      <p className="mt-2 text-sm leading-relaxed text-os-deep-muted">{live ? t("osRunningBody") : t("osEmptyBody")}</p>
      {!live && (
        <>
          <Link to="/onsave/new" className="mt-4 inline-flex h-12 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-bold text-[#241a4f]">
            <Plus className="h-5 w-5" /> {t("osCreateGroup")}
          </Link>
          <p className="mt-4 text-xs text-os-deep-muted">{t("osEmptyJoin")}</p>
        </>
      )}
    </section>
  );
}

function Due({ items }) {
  const t = useT();
  const lang = useLang();
  return (
    <section className={cn(card, "space-y-4 p-4")}>
      <h2 className="text-[15px] font-bold">{t("osDueFromYou")}</h2>
      {items.map(({ g, r }) => {
        const due = dueText(r.date, t, lang, formatDate);
        return (
          <div key={g.id} className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-os-brand-soft text-os-brand">
                <RefreshCw className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">{g.name}</p>
                <p className="truncate text-[13px] text-os-muted">{t("osToRecipient", { n: r.number, name: r.recipient_name })}</p>
              </div>
              <div className="text-right">
                <p className="os-display text-lg font-bold">{money(g.amount_cents, g.currency, lang)}</p>
                {due.text && <Chip tone={due.tone} className="mt-0.5">{due.text}</Chip>}
              </div>
            </div>
            <Link to={`/onsave/groups/${g.id}/pay`} className={cn(btnMoney, "w-full")}>
              <Check className="h-[18px] w-[18px]" strokeWidth={2.6} /> {t("osIPaid")}
            </Link>
          </div>
        );
      })}
    </section>
  );
}

// Money and Collections: the other family money tools inside onSave.
function MoreTools() {
  const t = useT();
  const tools = [
    ["/onsave/money", HandCoins, t("osLoans"), t("osLoansBody"), "bg-os-money-soft text-os-money"],
    ["/onsave/collections", HeartHandshake, t("collections"), t("osCollectionsBody"), "bg-os-brand-soft text-os-brand"],
  ];
  return (
    <section className="space-y-2.5">
      <h2 className="text-[15px] font-bold">{t("osMoreTools")}</h2>
      {tools.map(([to, Icon, title, body, tone]) => (
        <LinkCard key={to} to={to} className="flex items-center gap-3 rounded-2xl px-3.5 py-3">
          <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", tone)}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">{title}</span>
            <span className="block truncate text-[13px] text-os-muted">{body}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-os-muted" aria-hidden="true" />
        </LinkCard>
      ))}
    </section>
  );
}

export default function Home() {
  const api = useApi();
  const t = useT();
  const { user } = useUser();
  const [groups, setGroups] = useState(null);
  const [unread, setUnread] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.myGroups().then((d) => setGroups(d.groups)).catch((e) => setError(errorText(e)));
    api
      .activity()
      .then((d) => {
        const seen = lastSeenActivity();
        setUnread(d.events.some((e) => !e.you && e.at > seen));
      })
      .catch(() => {});
  }, [api]);

  const first = user?.firstName || user?.fullName || "";
  const due = groups ? dueItems(groups) : [];
  const confirm = groups ? toConfirm(groups) : [];
  const hasActive = groups?.some((g) => g.status === "active" && g.you);

  return (
    <div className="space-y-5 pt-2">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar name={user?.fullName || first} src={user?.hasImage ? user.imageUrl : undefined} size={44} />
          <div>
            <p className="text-[13px] text-os-muted">{t("osHello")}</p>
            <p className="os-display text-xl font-bold leading-tight">{first}</p>
          </div>
        </div>
        <Link to="/onsave/activity" aria-label={t("osNotifications")} className={cn(iconBtn, "relative")}>
          <Bell className="h-5 w-5" />
          {unread && <span className="absolute right-[11px] top-[10px] h-2.5 w-2.5 rounded-full border-2 border-os-card bg-[#d9467f]" />}
        </Link>
      </header>

      <ErrorNote>{error}</ErrorNote>
      {!groups && !error && <Spinner />}
      {groups && (
        <>
          <Hero groups={groups} />

          {due.length > 0 ? (
            <Due items={due} />
          ) : (
            hasActive && (
              <section className={cn(card, "flex items-center gap-3 p-4")}>
                <CheckCircle2 className="h-9 w-9 shrink-0 text-os-money" aria-hidden="true" />
                <div>
                  <p className="text-[15px] font-semibold">{t("osAllPaid")}</p>
                  <p className="text-[13px] text-os-muted">{t("osAllPaidBody")}</p>
                </div>
              </section>
            )
          )}

          {confirm.map(({ g, n }) => (
            <LinkCard key={g.id} to={`/onsave/groups/${g.id}`} className="flex items-center gap-3 p-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-os-warn-soft text-os-warn">
                <Check className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">{t("osToConfirm")}</p>
                <p className="truncate text-[13px] text-os-muted">{t("osToConfirmBody", { n, group: g.name })}</p>
              </div>
            </LinkCard>
          ))}

          {groups.length > 0 && (
            <section className="space-y-2.5">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[15px] font-bold">{t("osYourGroups")}</h2>
                <Link to="/onsave/groups" className="text-[13px] font-semibold text-os-brand hover:underline">
                  {t("osSeeAll")}
                </Link>
              </div>
              {groups.slice(0, 4).map((g) => (
                <GroupRow key={g.id} g={g} />
              ))}
            </section>
          )}
          <MoreTools />
        </>
      )}
    </div>
  );
}
