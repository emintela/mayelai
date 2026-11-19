import { useState } from "react";
import { Contact, MessageCircle, MessageSquareText, X } from "lucide-react";
import { canPickContacts, pickContacts } from "@/lib/contacts";
import { useT } from "@/lib/i18n";
import { smsURL, whatsappURL } from "@/lib/money";
import { cn } from "@/lib/utils";

// "From contacts" button. Renders nothing where the browser can't open the
// phone's contacts. onPick receives [{ name, phone }] (never empty).
export function ContactsButton({ multiple = false, onPick, className, children, disabled }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  if (!canPickContacts()) return null;
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        try {
          const people = await pickContacts({ multiple });
          if (people.length) await onPick(people);
        } finally {
          setBusy(false);
        }
      }}
      className={cn("inline-flex items-center gap-1.5 disabled:opacity-60", className)}
    >
      <Contact className="h-4 w-4" aria-hidden="true" />
      {children ?? t("osFromContacts")}
    </button>
  );
}

// People picked from contacts, each with WhatsApp / SMS buttons that open the
// sender's own app with the message (and their number) ready.
// message(person) returns the text for that person.
export function SendToPeople({ people, message, onClose, tone = "app" }) {
  const t = useT();
  if (!people.length) return null;
  const os = tone === "onsave";
  const btn = "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition";
  return (
    <div className={cn("space-y-2 rounded-2xl border p-3", os ? "border-os-line bg-os-bg" : "border-border bg-muted/40")}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{t("osSendInvites")}</p>
        {onClose && (
          <button type="button" onClick={onClose} aria-label={t("osClose")} className="rounded-full p-1 opacity-60 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {people.map((p, i) => {
          const text = message(p);
          return (
            <li key={`${p.name}-${i}`} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className={cn("block truncate text-xs", os ? "text-os-muted" : "text-muted-foreground")}>{p.phone || t("osNoPhone")}</span>
              </span>
              <span className="flex gap-1.5">
                <a
                  href={whatsappURL(p.phone, text)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(btn, "bg-[#1f8f5f] text-white hover:bg-[#187a50]")}
                >
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </a>
                <a href={smsURL(p.phone, text)} className={cn(btn, "border", os ? "border-os-line bg-os-card" : "border-border bg-card")}>
                  <MessageSquareText className="h-4 w-4" /> SMS
                </a>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
