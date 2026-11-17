import { useLang, useT } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/pages/money/parts";

// Progress bar: received (solid) and sent-but-unconfirmed (light) toward the goal or the promised total.
export function Progress({ col }) {
  const t = useT();
  const lang = useLang();
  const { received_cents: rec, sent_cents: sent, pledged_cents: pledged, count } = col.totals;
  const target = col.goal_cents || pledged || 1;
  const pct = (n) => `${Math.min(100, (n / target) * 100)}%`;
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p>
          <span className="text-2xl font-bold">{formatMoney(rec, col.currency, lang)}</span>{" "}
          <span className="text-sm text-muted-foreground">
            {t("received").toLowerCase()}
            {col.goal_cents ? ` ${t("ofGoal", { goal: formatMoney(col.goal_cents, col.currency, lang) })}` : ""}
          </span>
        </p>
        <p className="text-sm text-muted-foreground">
          {t("promised")}
          {lang === "fr" ? " : " : ": "}
          {formatMoney(pledged, col.currency, lang)} · {t("givers", { n: count })}
        </p>
      </div>
      <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-500/35" style={{ width: pct(rec + sent) }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-500" style={{ width: pct(rec) }} />
      </div>
    </div>
  );
}

export function ContributionBadge({ status }) {
  const t = useT();
  if (status === "received") return <Badge tone="green">✓ {t("receivedStatus")}</Badge>;
  if (status === "sent") return <Badge tone="amber">{t("sentStatus")}</Badge>;
  return <Badge tone="gray">{t("pledgedStatus")}</Badge>;
}
