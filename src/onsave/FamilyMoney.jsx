import { NavLink, Outlet, useLocation } from "react-router-dom";
import { HandCoins, HeartHandshake } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Money | Collections switch at the top of both list pages.
export function MoneySwitch() {
  const t = useT();
  const tab = ({ isActive }) =>
    cn(
      "flex h-10 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold transition",
      isActive ? "bg-os-card text-os-ink shadow-sm" : "text-os-muted hover:text-os-ink"
    );
  return (
    <nav aria-label={t("money")} className="grid grid-cols-2 gap-1 rounded-2xl bg-os-line-soft p-1">
      <NavLink to="/onsave/money" end className={tab}>
        <HandCoins className="h-4 w-4" aria-hidden="true" /> {t("money")}
      </NavLink>
      <NavLink to="/onsave/collections" end className={tab}>
        <HeartHandshake className="h-4 w-4" aria-hidden="true" /> {t("collections")}
      </NavLink>
    </nav>
  );
}

// Loans and Collections pages from Mayel'AI, opened inside onSave.
export default function FamilyMoney() {
  const { pathname } = useLocation();
  const isList = /^\/onsave\/collections\/?$/.test(pathname);
  return (
    <div className="pt-2">
      {isList && <MoneySwitch />}
      {/* These pages carry their own side padding; cancel the onSave column's. */}
      <div className="-mx-4 lg:-mx-8">
        <Outlet />
      </div>
    </div>
  );
}
