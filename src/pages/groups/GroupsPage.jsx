import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Plus, RefreshCcw } from "lucide-react";
import Heading from "@/components/heading";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge, Card, LangSwitch } from "@/pages/money/parts";

export function GroupStatus({ status }) {
  const t = useT();
  const tone = { forming: "amber", active: "violet", completed: "green", cancelled: "gray" }[status];
  return <Badge tone={tone}>{t(`status_${status}`)}</Badge>;
}

export default function GroupsPage() {
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.listGroups().then(setData).catch((e) => setError(errorText(e)));
  }, [api]);

  const list = data?.groups ?? [];
  const live = list.filter((g) => g.status === "forming" || g.status === "active").length;
  const limit = data?.active_limit ?? 0;
  const atLimit = limit > 0 && live >= limit;

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between gap-2 pr-4 lg:pr-8">
        <Heading title={t("groups")} description={t("groupsTagline")} icon={RefreshCcw} iconColor="text-sky-600" bgColor="bg-sky-500/10" />
        <LangSwitch className="shrink-0" />
      </div>
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 pb-12 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/likelemba/new"
            aria-disabled={atLimit}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90",
              atLimit && "pointer-events-none opacity-50"
            )}
          >
            <Plus className="h-4 w-4" /> {t("newGroup")}
          </Link>
          {limit > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("freeGroups", { max: limit })}{" "}
              <Link to="/settings" className="font-medium text-primary hover:underline">{t("upgrade")}</Link>
            </p>
          )}
        </div>
        {error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : !data ? (
          <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : list.length === 0 ? (
          <div className="py-10 text-center">
            <RefreshCcw className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-2 font-semibold">{t("noGroups")}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{t("noGroupsBody")}</p>
          </div>
        ) : (
          list.map((g) => {
            const round = g.status === "active" ? g.rounds[g.current_round - 1] : null;
            return (
              <Link key={g.id} to={`/likelemba/${g.id}`} className="block">
                <Card className="space-y-1 transition hover:border-primary/40">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {g.name} <GroupStatus status={g.status} />
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("perRound", { amount: formatMoney(g.amount_cents, g.currency, lang), pot: formatMoney(g.pot_cents, g.currency, lang) })} ·{" "}
                    {t(`freq_${g.frequency}`)} · {t("membersCount", { n: g.member_count })}
                  </p>
                  {round && (
                    <p className="text-sm">
                      {t("roundOf", { n: round.number, total: g.rounds.length })} ·{" "}
                      {t("paidCount", { n: round.received_count + round.sent_count, total: g.member_count })}
                    </p>
                  )}
                </Card>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
