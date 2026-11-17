import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { HeartHandshake, Loader2, Plus } from "lucide-react";
import Heading from "@/components/heading";
import { errorText, useApi } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Card, LangSwitch } from "@/pages/money/parts";
import { Progress } from "./parts";

export default function CollectionsPage() {
  const api = useApi();
  const t = useT();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.listCollections().then(setData).catch((e) => setError(errorText(e)));
  }, [api]);

  const list = data?.collections ?? [];
  const open = list.filter((c) => c.status === "open").length;
  const limit = data?.open_limit ?? 0;
  const atLimit = limit > 0 && open >= limit;

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between gap-2 pr-4 lg:pr-8">
        <Heading
          title={t("collections")}
          description={t("collectionsTagline")}
          icon={HeartHandshake}
          iconColor="text-rose-600"
          bgColor="bg-rose-500/10"
        />
        <LangSwitch className="shrink-0" />
      </div>
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 pb-12 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/collections/new"
            aria-disabled={atLimit}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90",
              atLimit && "pointer-events-none opacity-50"
            )}
          >
            <Plus className="h-4 w-4" /> {t("newCollection")}
          </Link>
          {limit > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("freeCollections", { max: limit })}{" "}
              <Link to="/settings" className="font-medium text-primary hover:underline">
                {t("upgrade")}
              </Link>
            </p>
          )}
        </div>

        {error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : !data ? (
          <div className="flex justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : list.length === 0 ? (
          <div className="py-10 text-center">
            <HeartHandshake className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-2 font-semibold">{t("noCollections")}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{t("noCollectionsBody")}</p>
          </div>
        ) : (
          list.map((c) => (
            <Link key={c.id} to={`/collections/${c.id}`} className="block">
              <Card className={cn("space-y-3 transition hover:border-primary/40", c.status !== "open" && "opacity-70")}>
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t(`kind_${c.kind}`)}
                    {c.status !== "open" && ` · ${t("collectionClosed")}`}
                  </p>
                  <p className="font-semibold">{c.title}</p>
                </div>
                <Progress col={c} />
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
