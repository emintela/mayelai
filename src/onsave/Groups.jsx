import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { GroupRow } from "./Home";
import { ErrorNote, Spinner, btnBrand } from "./ui";

const TABS = [
  ["running", "osTabRunning", (g) => g.status === "active"],
  ["forming", "osTabForming", (g) => g.status === "forming"],
  ["finished", "osTabFinished", (g) => g.status === "completed" || g.status === "cancelled"],
];

export default function Groups() {
  const api = useApi();
  const t = useT();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(null);
  useEffect(() => {
    api.myGroups().then(setData).catch((e) => setError(errorText(e)));
  }, [api]);

  const groups = data?.groups ?? [];
  // Open the first tab that has something in it.
  const active = tab ?? TABS.find(([, , f]) => groups.some(f))?.[0] ?? "running";
  const filter = TABS.find(([id]) => id === active)[2];
  const shown = groups.filter(filter);
  const limit = data?.active_limit ?? 0;
  const live = groups.filter((g) => g.role === "organizer" && (g.status === "forming" || g.status === "active")).length;

  return (
    <div className="space-y-5 pt-2">
      <div className="flex items-center justify-between">
        <h1 className="os-display text-[28px] font-extrabold">{t("osGroups")}</h1>
        <Link to="/onsave/new" aria-label={t("osNewGroup")} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-os-btn text-white">
          <Plus className="h-5 w-5" />
        </Link>
      </div>
      <div role="tablist" className="grid grid-cols-3 gap-1 rounded-2xl bg-os-line-soft p-1">
        {TABS.map(([id, key, f]) => {
          const n = groups.filter(f).length;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active === id}
              onClick={() => setTab(id)}
              className={cn(
                "h-10 rounded-xl text-[13px] font-semibold transition",
                active === id ? "bg-os-card text-os-ink shadow-sm" : "text-os-muted hover:text-os-ink"
              )}
            >
              {t(key)}
              {n > 0 && <span className="ml-1 text-os-muted">{n}</span>}
            </button>
          );
        })}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!data && !error ? (
        <Spinner />
      ) : shown.length ? (
        <div className="space-y-2.5">
          {shown.map((g) => (
            <GroupRow key={g.id} g={g} />
          ))}
        </div>
      ) : (
        <p className="py-10 text-center text-sm text-os-muted">{t("osNoneHere")}</p>
      )}
      {limit > 0 && (
        <p className="text-center text-xs text-os-muted">
          {t("osFreeLimit", { max: limit })}{" "}
          {live >= limit && (
            <Link to="/settings" className="font-semibold text-os-brand hover:underline">
              {t("upgrade")}
            </Link>
          )}
        </p>
      )}
      {data && groups.length === 0 && (
        <Link to="/onsave/new" className={cn(btnBrand, "w-full")}>
          <Plus className="h-5 w-5" /> {t("osCreateGroup")}
        </Link>
      )}
    </div>
  );
}
