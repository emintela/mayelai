import { NavLink, Outlet, useLocation } from "react-router-dom";
import { HandCoins, HeartHandshake } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Money (loans) and Collections, opened inside onSave. The list pages get a
// Loans | Collections switch; the pages themselves are the Mayel'AI ones.
export default function FamilyMoney() {
  const t = useT();
  const { pathname } = useLocation();
  const isList = /^\/onsave\/(money|collections)\/?$/.test(pathname);
  const tab = ({ isActive }) =>
    cn(
      "flex h-10 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold transition",
      isActive ? "bg-os-card text-os-ink shadow-sm" : "text-os-muted hover:text-os-ink"
    );
  return (
    <div className="pt-2">
      {isList && (
        <nav aria-label={t("money")} className="grid grid-cols-2 gap-1 rounded-2xl bg-os-line-soft p-1">
          <NavLink to="/onsave/money" className={tab}>
            <HandCoins className="h-4 w-4" aria-hidden="true" /> {t("osLoans")}
          </NavLink>
          <NavLink to="/onsave/collections" className={tab}>
            <HeartHandshake className="h-4 w-4" aria-hidden="true" /> {t("collections")}
          </NavLink>
        </nav>
      )}
      {/* The pages carry their own side padding; cancel the onSave column's. */}
      <div className="-mx-4 lg:-mx-8">
        <Outlet />
      </div>
    </div>
  );
}
