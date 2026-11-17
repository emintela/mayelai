import { useState } from "react";
import { Check, Copy, MessageCircle, MessageSquareText } from "lucide-react";
import { setLang, useLang, useT } from "@/lib/i18n";
import { smsURL, whatsappURL } from "@/lib/money";
import { cn } from "@/lib/utils";

export function LangSwitch({ className }) {
  const lang = useLang();
  const t = useT();
  return (
    <div className={cn("inline-flex items-center gap-1 rounded-full border border-border bg-card p-1 text-xs", className)}>
      {[
        ["en", "EN"],
        ["fr", "FR"],
      ].map(([code, label]) => (
        <button
          key={code}
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={cn(
            "rounded-full px-2.5 py-1 font-medium transition",
            lang === code ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {label}
        </button>
      ))}
      <span title={t("lingalaSoon")} className="cursor-default px-2 py-1 text-muted-foreground/60">
        LN
      </span>
    </div>
  );
}

export const Card = ({ className, children }) => (
  <section className={cn("rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5", className)}>{children}</section>
);

const tones = {
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  amber: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  red: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  gray: "bg-muted text-muted-foreground",
  violet: "bg-primary/10 text-primary",
};

export const Badge = ({ tone = "gray", children }) => (
  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", tones[tone])}>
    {children}
  </span>
);

export function ResponseBadge({ response }) {
  const t = useT();
  if (response === "confirmed") return <Badge tone="green">✓ {t("confirmed")}</Badge>;
  if (response === "declined") return <Badge tone="red">{t("disputed")}</Badge>;
  return <Badge tone="gray">{t("waiting")}</Badge>;
}

export function StatusBadge({ status }) {
  const t = useT();
  if (status === "paid") return <Badge tone="green">{t("statusPaid")}</Badge>;
  if (status === "forgiven") return <Badge tone="violet">{t("statusForgiven")}</Badge>;
  if (status === "cancelled") return <Badge tone="gray">{t("statusCancelled")}</Badge>;
  return null;
}

// Send buttons: WhatsApp / SMS open the user's own app with the text ready;
// onSent(channel) runs after the click (e.g. to log a reminder).
export function SendButtons({ phone, text, onSent, disabled }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onSent?.("copy");
    } catch {
      /* clipboard blocked */
    }
  };
  const btn =
    "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50";
  return (
    <div className="flex flex-wrap gap-2">
      <a
        href={whatsappURL(phone, text)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onSent?.("whatsapp")}
        aria-disabled={disabled}
        className={cn(btn, "bg-emerald-600 text-white hover:bg-emerald-700", disabled && "pointer-events-none opacity-50")}
      >
        <MessageCircle className="h-4 w-4" /> {t("whatsapp")}
      </a>
      <a
        href={smsURL(phone, text)}
        onClick={() => onSent?.("sms")}
        aria-disabled={disabled}
        className={cn(btn, "border border-border hover:bg-accent", disabled && "pointer-events-none opacity-50")}
      >
        <MessageSquareText className="h-4 w-4" /> {t("sms")}
      </a>
      <button type="button" onClick={copy} disabled={disabled} className={cn(btn, "border border-border hover:bg-accent")}>
        {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} {copied ? t("copied") : t("copy")}
      </button>
    </div>
  );
}

export const inputCls =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-base outline-none transition focus:ring-2 focus:ring-primary/30 md:text-sm";
export const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";
