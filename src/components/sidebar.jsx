import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { UserButton, useUser } from "@clerk/clerk-react";
import {
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Crown,
  HandCoins,
  HeartHandshake,
  History,
  Plus,
  RefreshCcw,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi } from "@/lib/api";
import ChatHistory from "@/components/chat-history";

// onSave is the main app; Money and Collections open inside it.
const ONSAVE = { to: "/onsave", label: "onSave", icon: RefreshCcw };
const ONSAVE_TOOLS = [
  { to: "/onsave/money", label: "Money", icon: HandCoins },
  { to: "/onsave/collections", label: "Collections", icon: HeartHandshake },
];

// Icon-only link with a tooltip, for the collapsed rail.
function RailLink({ to, label, icon: Icon, active, primary, onClick, iconClass }) {
  const Tag = to ? Link : "button";
  return (
    <Tag
      {...(to ? { to } : { type: "button", onClick })}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-11 w-11 items-center justify-center rounded-xl transition",
        primary
          ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30 hover:bg-primary/90"
          : active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
      )}
    >
      <Icon className={cn("h-5 w-5", iconClass)} />
      <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background opacity-0 shadow-md transition group-hover:opacity-100 group-focus-visible:opacity-100">
        {label}
      </span>
    </Tag>
  );
}

function Logo({ className }) {
  return (
    <span className={cn("relative flex h-9 w-9 shrink-0 overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-sidebar-border", className)}>
      <img alt="" src="/logo1.png" className="absolute inset-0 h-full w-full object-contain" />
    </span>
  );
}

// Free users see an "Upgrade to Pro" card; Pro users don't.
function usePlan() {
  const api = useApi();
  const [plan, setPlan] = useState(null);
  useEffect(() => {
    api
      .getBilling()
      .then((b) => setPlan(b?.subscription?.plan || "free"))
      .catch(() => {});
  }, [api]);
  return plan;
}

// collapsed: icon rail. onToggle: shows the « / » button (desktop only).
const Sidebar = ({ collapsed = false, onToggle }) => {
  const { pathname } = useLocation();
  const { user } = useUser();
  const plan = usePlan();
  const showUpgrade = plan && plan !== "pro";
  const isActive = (to) => pathname === to || pathname.startsWith(to + "/");
  const onSaveHome = isActive(ONSAVE.to) && !ONSAVE_TOOLS.some((f) => isActive(f.to));

  if (collapsed)
    return (
      <div className="flex h-full flex-col items-center gap-2 bg-sidebar py-4 text-sidebar-foreground">
        <Link to="/chat" aria-label="Mayel'AI" className="mb-2">
          <Logo />
        </Link>
        <RailLink to="/chat" label="New chat" icon={Plus} primary />
        <div className="my-1 h-px w-8 bg-sidebar-border" />
        <RailLink {...ONSAVE} active={onSaveHome} />
        {ONSAVE_TOOLS.map((f) => (
          <RailLink key={f.to} {...f} active={isActive(f.to)} />
        ))}
        <div className="my-1 h-px w-8 bg-sidebar-border" />
        <RailLink label="Chat history" icon={History} onClick={onToggle} />
        <div className="flex-1" />
        {showUpgrade && <RailLink to="/settings" label="Upgrade to Pro" icon={Crown} iconClass="text-amber-500" />}
        <RailLink to="/settings" label="Settings" icon={Settings} active={pathname === "/settings"} />
        <RailLink label="Expand menu" icon={ChevronsRight} onClick={onToggle} />
      </div>
    );

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Top (fixed) */}
      <div className="shrink-0 space-y-4 px-4 pb-3 pt-5">
        <div className="flex items-center justify-between gap-2">
          <Link to="/chat" className="flex min-w-0 items-center gap-2.5 pl-1">
            <Logo />
            <span className="truncate text-[22px] font-bold tracking-tight text-foreground" style={{ fontFamily: "Montserrat, sans-serif" }}>
              Mayel'AI
            </span>
          </Link>
          {onToggle && (
            <button
              type="button"
              onClick={onToggle}
              aria-label="Collapse menu"
              title="Collapse menu"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
          )}
        </div>

        <Link
          to="/chat"
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/30 transition hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          New chat
        </Link>

        <nav aria-label="onSave" className="space-y-1">
          {/* Main app: onSave (tontine) */}
          <Link
            to={ONSAVE.to}
            aria-current={onSaveHome ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-2 py-2 transition",
              onSaveHome ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60"
            )}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm shadow-primary/30">
              <RefreshCcw className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">onSave</span>
              <span className="block truncate text-xs text-muted-foreground">Tontine · savings groups</span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
          </Link>
          {/* Tools inside onSave */}
          <div className="ml-[26px] space-y-0.5 border-l border-sidebar-border pl-3">
            {ONSAVE_TOOLS.map(({ to, label, icon: Icon }) => {
              const active = isActive(to);
              return (
                <Link
                  key={to}
                  to={to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition",
                    active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60"
                  )}
                >
                  <Icon className={cn("h-4 w-4", active ? "" : "text-muted-foreground")} />
                  {label}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>

      <div className="mx-5 shrink-0 border-t border-sidebar-border" />

      {/* Middle (scrolls) */}
      <ChatHistory />

      {/* Bottom (fixed) */}
      <div className="shrink-0 space-y-2 px-4 pb-4 pt-2">
        {showUpgrade && (
          <Link
            to="/settings"
            className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-gradient-to-r from-amber-50 to-violet-50 p-3 transition hover:shadow-sm dark:from-amber-500/10 dark:to-violet-500/10"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-400/20 text-amber-500">
              <Crown className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">Upgrade to Pro</span>
              <span className="block truncate text-xs text-muted-foreground">Unlock more features</span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        )}
        <div className="flex items-center gap-2">
          <Link
            to="/settings"
            className={cn(
              "flex h-11 flex-1 items-center gap-3 rounded-xl px-3 text-sm font-medium transition hover:bg-sidebar-accent/60",
              pathname === "/settings" ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground"
            )}
          >
            <Settings className="h-5 w-5" />
            Settings
          </Link>
          <span className="flex h-11 w-11 items-center justify-center" title={user?.fullName || undefined}>
            <UserButton />
          </span>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
