import { useEffect, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { SignedIn, SignedOut } from "@clerk/clerk-react";
import { HandCoins, Home, Plus, User, Users } from "lucide-react";
import { useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { refreshPush } from "@/lib/push";
import { cn } from "@/lib/utils";
import { claimRemembered } from "./memberStore";
import { Spinner, useOnSaveChrome } from "./ui";

// Full-screen flows (paying, creating a group, loan or collection) hide the tab bar.
const fullScreen = (path) => /^\/onsave\/(new|groups\/[^/]+\/pay|money\/new|money\/send|collections\/new)\/?$/.test(path);

// The + button creates whatever the current section is about.
function plusFor(path, t) {
  if (path.startsWith("/onsave/money")) return ["/onsave/money/send?mode=request", t("osmRequest")];
  if (path.startsWith("/onsave/collections")) return ["/onsave/collections/new", t("osNewCollection")];
  return ["/onsave/new", t("osNewGroup")];
}

function TabBar() {
  const t = useT();
  const { pathname } = useLocation();
  const [plusTo, plusLabel] = plusFor(pathname, t);
  const inMoney = /^\/onsave\/(money|collections)/.test(pathname);
  const tab = ({ isActive }) =>
    cn(
      "flex w-16 flex-col items-center gap-1 rounded-xl py-1 text-[11px] font-medium transition",
      isActive ? "font-semibold text-os-brand" : "text-os-muted hover:text-os-ink"
    );
  return (
    <nav
      aria-label="onSave"
      className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg border-t border-os-line bg-os-card/95 backdrop-blur-md"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 10px)" }}
    >
      <div className="flex items-center justify-around px-3 pt-2">
        <NavLink to="/onsave" end className={tab}>
          <Home className="h-[22px] w-[22px]" aria-hidden="true" />
          {t("osHome")}
        </NavLink>
        <NavLink to="/onsave/groups" className={tab}>
          <Users className="h-[22px] w-[22px]" aria-hidden="true" />
          {t("osGroups")}
        </NavLink>
        <NavLink
          to={plusTo}
          aria-label={plusLabel}
          className="-mt-1 inline-flex h-13 w-13 items-center justify-center rounded-full bg-os-btn text-white shadow-[0_8px_20px_rgba(90,63,212,0.35)] transition active:scale-95"
        >
          <Plus className="h-6 w-6" strokeWidth={2.4} aria-hidden="true" />
        </NavLink>
        <NavLink to="/onsave/money" className={(p) => tab({ isActive: p.isActive || inMoney })}>
          <HandCoins className="h-[22px] w-[22px]" aria-hidden="true" />
          {t("money")}
        </NavLink>
        <NavLink to="/onsave/me" className={tab}>
          <User className="h-[22px] w-[22px]" aria-hidden="true" />
          {t("osMe")}
        </NavLink>
      </div>
    </nav>
  );
}

function Shell() {
  const api = useApi();
  const { pathname } = useLocation();
  const [ready, setReady] = useState(false);
  const lang = useLang();
  useEffect(() => {
    claimRemembered(api).finally(() => setReady(true));
  }, [api]);
  // Alerts already on: keep the server's copy and its language up to date.
  useEffect(() => {
    refreshPush(api, lang);
  }, [api, lang]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  const tabs = !fullScreen(pathname);
  return (
    <div className="onsave min-h-dvh">
      <div className={cn("mx-auto flex min-h-dvh max-w-lg flex-col px-5", tabs ? "pb-32" : "pb-8")} style={{ paddingTop: "max(env(safe-area-inset-top), 20px)" }}>
        {ready ? <Outlet /> : <Spinner />}
      </div>
      {tabs && <TabBar />}
    </div>
  );
}

export default function OnSaveLayout() {
  useOnSaveChrome();
  return (
    <>
      <SignedIn>
        <Shell />
      </SignedIn>
      <SignedOut>
        <Navigate to="/onsave/welcome" replace />
      </SignedOut>
    </>
  );
}
