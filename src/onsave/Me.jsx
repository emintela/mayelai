import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useClerk, useUser } from "@clerk/clerk-react";
import { useTheme } from "next-themes";
import { ChevronRight, Download, LogOut, MessageSquare } from "lucide-react";
import { useApi } from "@/lib/api";
import { setLang, useLang, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Avatar, LogoMark, Wordmark, btnBrand, card } from "./ui";
import { AlertsCard, PayHandlesCard } from "./money/shared";

// Chrome/Android fire beforeinstallprompt once; keep it for the Install button.
let deferredPrompt = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });
}

const standalone = () =>
  typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);
const isIOS = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

function Install() {
  const t = useT();
  const [, force] = useState(0);
  const [installed, setInstalled] = useState(standalone());
  useEffect(() => {
    const ready = () => force((n) => n + 1);
    const done = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", done);
    };
  }, []);
  if (installed) return <p className="px-1 text-center text-xs text-os-muted">{t("osInstalled")}</p>;
  if (!deferredPrompt && !isIOS()) return null;
  return (
    <section className={cn(card, "space-y-3 p-4")}>
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-os-deep">
          <LogoMark size={30} />
        </span>
        <div>
          <p className="text-[15px] font-semibold">{t("osInstall")}</p>
          <p className="text-[13px] text-os-muted">{t("osInstallBody")}</p>
        </div>
      </div>
      {deferredPrompt ? (
        <button
          type="button"
          className={cn(btnBrand, "w-full")}
          onClick={async () => {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            deferredPrompt = null;
            if (outcome === "accepted") setInstalled(true);
            else force((n) => n + 1);
          }}
        >
          <Download className="h-4 w-4" /> {t("osInstallButton")}
        </button>
      ) : (
        <p className="rounded-2xl bg-os-bg p-3 text-[13px]">{t("osInstallIos")}</p>
      )}
    </section>
  );
}

function Segmented({ value, options, onChange, labelText }) {
  return (
    <div role="group" aria-label={labelText} className="grid gap-1 rounded-2xl bg-os-line-soft p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([v, text, disabled]) => (
        <button
          key={v}
          type="button"
          disabled={disabled}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "h-10 rounded-xl text-sm font-semibold transition disabled:opacity-50",
            value === v ? "bg-os-card text-os-ink shadow-sm" : "text-os-muted hover:text-os-ink"
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export default function Me() {
  const t = useT();
  const lang = useLang();
  const api = useApi();
  const navigate = useNavigate();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { theme, setTheme } = useTheme();
  const [plan, setPlan] = useState(null);
  useEffect(() => {
    api.myGroups().then((d) => setPlan(d.plan)).catch(() => {});
  }, [api]);

  const row = "flex min-h-14 items-center gap-3 px-4 text-[15px] font-medium transition hover:bg-os-line-soft";
  return (
    <div className="space-y-5 pt-2">
      <h1 className="os-display text-[28px] font-extrabold">{t("osMe")}</h1>
      <section className={cn(card, "flex items-center gap-4 p-4")}>
        <Avatar name={user?.fullName || ""} src={user?.hasImage ? user.imageUrl : undefined} size={56} />
        <div className="min-w-0">
          <p className="os-display truncate text-lg font-bold">{user?.fullName}</p>
          <p className="truncate text-sm text-os-muted">{user?.primaryEmailAddress?.emailAddress}</p>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-[13px] font-semibold text-os-muted">{t("osLanguage")}</h2>
        <Segmented
          value={lang}
          onChange={setLang}
          labelText={t("osLanguage")}
          options={[
            ["en", "English"],
            ["fr", "Français"],
            ["ln", "Lingala", true],
          ]}
        />
        <p className="px-1 text-xs text-os-muted">{t("lingalaSoon")}</p>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-[13px] font-semibold text-os-muted">{t("osAppearance")}</h2>
        <Segmented
          value={theme}
          onChange={setTheme}
          labelText={t("osAppearance")}
          options={[
            ["light", t("osLight")],
            ["dark", t("osDark")],
            ["system", t("osSystem")],
          ]}
        />
      </section>

      <Install />
      <AlertsCard />
      <PayHandlesCard />

      <section className={cn(card, "divide-y divide-os-line-soft overflow-hidden")}>
        <Link to="/settings" className={row}>
          <span className="flex-1">{t("osPlan")}</span>
          {plan && <span className="text-sm text-os-muted">{plan === "pro" ? t("osPlanPro") : t("osPlanFree")}</span>}
          <ChevronRight className="h-4 w-4 text-os-muted" />
        </Link>
        <Link to="/chat" className={row}>
          <MessageSquare className="h-5 w-5 text-os-brand" />
          <span className="flex-1">{t("osOpenChat")}</span>
          <ChevronRight className="h-4 w-4 text-os-muted" />
        </Link>
        <button type="button" onClick={() => signOut(() => navigate("/onsave/welcome"))} className={cn(row, "w-full text-left text-os-danger")}>
          <LogOut className="h-5 w-5" />
          <span className="flex-1">{t("osSignOut")}</span>
        </button>
      </section>

      <div className="flex flex-col items-center gap-1 pt-2 text-center">
        <div className="flex items-center gap-2">
          <LogoMark size={22} />
          <Wordmark className="text-base" />
        </div>
        <p className="text-xs text-os-muted">
          {t("osTagline")} · {t("osNoMoney")}
        </p>
      </div>
    </div>
  );
}
