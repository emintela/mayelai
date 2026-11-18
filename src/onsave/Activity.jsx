import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Clock, RefreshCw, UserPlus } from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Avatar, ErrorNote, Spinner, card, money } from "./ui";

const SEEN = "onsave.activitySeen";
export function lastSeenActivity() {
  try {
    return localStorage.getItem(SEEN) || "";
  } catch {
    return "";
  }
}

function sentence(e, t, lang) {
  const amount = money(e.amount_cents, e.currency, lang);
  const v = { who: e.who, group: e.group_name, amount, n: e.round };
  switch (e.kind) {
    case "joined":
      return t(e.you ? "osEvJoinedYou" : "osEvJoined", v);
    case "sent": {
      const s = t(e.you ? "osEvSentYou" : "osEvSent", v);
      return e.method ? `${s} ${t("osEvByMethod", { method: e.method })}` : s;
    }
    case "received":
      return t(e.you ? "osEvReceivedYou" : "osEvReceived", v);
    default:
      return t(e.you ? "osEvPayoutYou" : "osEvPayout", v);
  }
}

function EventIcon({ e }) {
  const box = "flex h-9 w-9 shrink-0 items-center justify-center rounded-full";
  if (e.kind === "received") return <span className={cn(box, "bg-os-money-soft text-os-money")}><Check className="h-[18px] w-[18px]" strokeWidth={2.6} /></span>;
  if (e.kind === "payout") return <span className={cn(box, "bg-os-deep text-os-mint")}><RefreshCw className="h-[18px] w-[18px]" /></span>;
  if (e.kind === "sent" && e.you) return <span className={cn(box, "bg-os-warn-soft text-os-warn")}><Clock className="h-[18px] w-[18px]" /></span>;
  if (e.kind === "joined" && e.you) return <span className={cn(box, "bg-os-brand-soft text-os-brand")}><UserPlus className="h-[18px] w-[18px]" /></span>;
  return <Avatar name={e.who} size={36} />;
}

function bucket(at) {
  const d = new Date(at);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d >= startOfToday) return "osToday";
  if (d >= new Date(startOfToday.getTime() - 6 * 86400000)) return "osThisWeek";
  return "osEarlier";
}

function when(at, lang) {
  const d = new Date(at);
  const locale = lang === "fr" ? "fr-FR" : "en-US";
  if (bucket(at) === "osToday") return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (bucket(at) === "osThisWeek") return d.toLocaleDateString(locale, { weekday: "short" });
  return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

export default function Activity() {
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api
      .activity()
      .then((d) => {
        setEvents(d.events);
        try {
          if (d.events[0]) localStorage.setItem(SEEN, d.events[0].at);
        } catch {
          /* ignore */
        }
      })
      .catch((e) => setError(errorText(e)));
  }, [api]);

  const groups = [];
  for (const e of events ?? []) {
    const b = bucket(e.at);
    if (!groups.length || groups[groups.length - 1].b !== b) groups.push({ b, items: [] });
    groups[groups.length - 1].items.push(e);
  }

  return (
    <div className="space-y-4 pt-2">
      <h1 className="os-display text-[28px] font-extrabold">{t("osActivity")}</h1>
      <ErrorNote>{error}</ErrorNote>
      {!events && !error && <Spinner />}
      {events?.length === 0 && <p className="py-10 text-center text-sm text-os-muted">{t("osNoActivity")}</p>}
      {groups.map(({ b, items }) => (
        <section key={b} className="space-y-2">
          <h2 className="px-1 pt-1 text-xs font-semibold uppercase tracking-[0.08em] text-os-muted">{t(b)}</h2>
          <ul className={cn(card, "divide-y divide-os-line-soft overflow-hidden")}>
            {items.map((e, i) => (
              <li key={i}>
                <Link to={`/onsave/groups/${e.group_id}`} className="flex gap-3 px-4 py-3.5 transition hover:bg-os-line-soft">
                  <EventIcon e={e} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{sentence(e, t, lang)}</p>
                    <p className="mt-0.5 truncate text-xs text-os-muted">
                      {e.group_name}
                      {e.round ? ` · ${t("osRoundShort", { n: e.round })}` : ""} · {when(e.at, lang)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
