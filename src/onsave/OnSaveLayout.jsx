import { useEffect, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { SignedIn, SignedOut } from "@clerk/clerk-react";
import { BarChart3, HandCoins, Home, MessageCircle, Plus, User, Users } from "lucide-react";
import { useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { onAlertTap, refreshPush } from "@/lib/push";
import { cn } from "@/lib/utils";
import { claimRemembered } from "./memberStore";
import { Spinner, useOnSaveChrome } from "./ui";

// Full-screen flows (paying, creating a group, loan or collection) hide the tab bar.
const fullScreen = (path) => /^\/onsave\/(new|groups\/[^/]+\/pay|money\/new|money\/send|collections\/new|ask(\/[^/]+)?)\/?$/.test(path);

// The + button creates whatever the current section is about.
function plusFor(path, t) {
  if (path.startsWith("/onsave/money")) return ["/onsave/money/send?mode=request", t("osmRequest")];
  if (path.startsWith("/onsave/collections")) return ["/onsave/collections/new", t("osNewCollection")];
  return ["/onsave/new", t("osNewGroup")];
}

// Bottom menu: Home · Chat · onSave · + · Money · AI Fin · Me.
const TABS = [
  ["/onsave", Home, "tabHome", (p) => /^\/onsave\/?$/.test(p)],
  ["/onsave/ask", MessageCircle, "tabChat", (p) => p.startsWith("/onsave/ask")],
  ["/onsave/save", Users, "tabOnSave", (p) => /^\/onsave\/(save|groups|collections|activity)/.test(p)],
  null, // the + button
  ["/onsave/money", HandCoins, "money", (p) => p.startsWith("/onsave/money")],
  ["/onsave/fin", BarChart3, "tabAiFin", (p) => /^\/onsave\/(fin|budget|alerts)/.test(p)],
  ["/onsave/me", User, "tabMe", (p) => p.startsWith("/onsave/me")],
];

function Tab({ to, Icon, label, active }) {
  return (
    <NavLink
      to={to}
      end
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl py-1 text-[10.5px] font-medium transition",
        active ? "font-semibold text-os-brand" : "text-os-muted hover:text-os-ink"
      )}
    >
      <Icon className="h-[22px] w-[22px]" aria-hidden="true" />
      <span className="max-w-full truncate">{label}</span>
    </NavLink>
  );
}

function TabBar() {
  const t = useT();
  const { pathname } = useLocation();
  const [plusTo, plusLabel] = plusFor(pathname, t);
  return (
    <nav
      aria-label="Mayel'AI"
      className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg border-t border-os-line bg-os-card/95 backdrop-blur-md"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 10px)" }}
    >
      <div className="flex items-center px-1 pt-2">
        {TABS.map((tab) =>
          tab ? (
            <Tab key={tab[0]} to={tab[0]} Icon={tab[1]} label={t(tab[2])} active={tab[3](pathname)} />
          ) : (
            <span key="plus" className="flex flex-1 justify-center">
              <NavLink
                to={plusTo}
                aria-label={plusLabel}
                className="-mt-1 inline-flex h-12 w-12 items-center justify-center rounded-full bg-os-btn text-white shadow-[0_8px_20px_rgba(90,63,212,0.35)] transition active:scale-95"
              >
                <Plus className="h-6 w-6" strokeWidth={2.4} aria-hidden="true" />
              </NavLink>
            </span>
          )
        )}
      </div>
    </nav>
  );
}

function Shell() {
  const api = useApi();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const lang = useLang();
  useEffect(() => {
    claimRemembered(api).finally(() => setReady(true));
  }, [api]);
  // Alerts already on: keep the server's copy and its language up to date.
  useEffect(() => {
    refreshPush(api, lang);
  }, [api, lang]);
  // Phone app: tapping an alert opens its page.
  useEffect(() => onAlertTap(navigate), [navigate]);
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
