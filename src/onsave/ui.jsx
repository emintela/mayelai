import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useT } from "@/lib/i18n";
import { daysUntil, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

// ---------- brand ----------

export function LogoMark({ size = 28, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <circle cx="16" cy="16" r="11" fill="none" stroke="#8c76f0" strokeWidth="2.5" strokeDasharray="3 5" />
      <circle cx="16" cy="5" r="4" fill="#3fc48e" />
    </svg>
  );
}

export function Wordmark({ light, className }) {
  return (
    <span className={cn("os-display text-lg font-bold tracking-tight", className)}>
      <span className={light ? "text-os-mint" : "text-os-brand"}>on</span>
      <span className={light ? "text-white" : "text-os-ink"}>Save</span>
    </span>
  );
}

// Sets the tab title, theme color and install manifest while an onSave page is open.
export function useOnSaveChrome(title = "onSave") {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;
    const added = [];
    const ensure = (selector, make) => {
      let el = document.head.querySelector(selector);
      if (!el) {
        el = make();
        document.head.appendChild(el);
        added.push(el);
      }
      return el;
    };
    ensure('link[rel="manifest"]', () => Object.assign(document.createElement("link"), { rel: "manifest", href: "/onsave-assets/manifest.json" }));
    const touch = document.head.querySelector('link[rel="apple-touch-icon"]');
    const prevTouch = touch?.getAttribute("href");
    touch?.setAttribute("href", "/onsave-assets/apple-touch-icon.png");
    const appTitle = ensure('meta[name="apple-mobile-web-app-title"]', () =>
      Object.assign(document.createElement("meta"), { name: "apple-mobile-web-app-title" })
    );
    appTitle.setAttribute("content", "onSave");
    return () => {
      document.title = prevTitle;
      added.forEach((el) => el.remove());
      if (touch && prevTouch) touch.setAttribute("href", prevTouch);
    };
  }, [title]);
}

// ---------- people ----------

const AVATARS = [
  ["#e9c9a8", "#5a3412"],
  ["#f3b6cc", "#6e1e3d"],
  ["#3fc48e", "#08402b"],
  ["#e4defa", "#3f2aa8"],
  ["#5a3fd4", "#ffffff"],
  ["#fcd9a8", "#6a3b00"],
  ["#bfe3f5", "#0b4a66"],
];

export function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = [...parts[0]][0] ?? "";
  const last = parts.length > 1 ? [...parts[parts.length - 1]][0] ?? "" : [...parts[0]][1] ?? "";
  return (first + last).toUpperCase();
}

function colorsFor(name = "") {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return AVATARS[h % AVATARS.length];
}

export function Avatar({ name, src, size = 36, ring, className }) {
  const [bg, fg] = colorsFor(name);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (src) return <img src={src} alt="" style={style} className={cn("shrink-0 rounded-full object-cover", ring && "ring-2 ring-os-card", className)} />;
  return (
    <span
      aria-hidden="true"
      style={{ ...style, background: bg, color: fg }}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-bold", ring && "ring-2 ring-os-card", className)}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ names, max = 3, size = 30 }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <div className="flex">
      {shown.map((n, i) => (
        <Avatar key={i} name={n} size={size} ring className={i ? "-ml-1.5" : ""} />
      ))}
      {extra > 0 && (
        <span
          style={{ width: size, height: size }}
          className="-ml-1.5 inline-flex shrink-0 items-center justify-center rounded-full bg-os-ink text-[11px] font-bold text-os-bg ring-2 ring-os-card"
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

// ---------- small parts ----------

const CHIP = {
  money: "bg-os-money-soft text-os-money",
  warn: "bg-os-warn-soft text-os-warn",
  brand: "bg-os-brand-soft text-os-brand-ink",
  muted: "bg-os-line-soft text-os-muted",
};

export const Chip = ({ tone = "muted", className, children }) => (
  <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", CHIP[tone], className)}>{children}</span>
);

export function GroupChip({ status }) {
  const t = useT();
  const tone = { forming: "warn", active: "money", completed: "brand", cancelled: "muted" }[status];
  return <Chip tone={tone}>{t(`osStatus_${status}`)}</Chip>;
}

export function PaymentChip({ payment }) {
  const t = useT();
  if (payment?.status === "received") return <Chip tone="money">{t("osReceived")}</Chip>;
  if (payment?.status === "sent") return <Chip tone="warn">{t("osSaysPaid")}</Chip>;
  return <Chip>{t("osNotYet")}</Chip>;
}

export const card = "rounded-3xl border border-os-line bg-os-card";
export const btn =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";
export const btnBrand = cn(btn, "bg-os-btn text-white hover:bg-[#4b33bd]");
export const btnMoney = cn(btn, "bg-os-btn-money text-white hover:bg-[#09684a]");
export const btnGhost = cn(btn, "border border-os-line bg-os-card text-os-ink hover:bg-os-line-soft");
export const smallBtn =
  "inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-os-line bg-os-card px-3 text-xs font-semibold text-os-ink transition hover:bg-os-line-soft disabled:opacity-50";
export const iconBtn =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-os-line bg-os-card text-os-ink transition hover:bg-os-line-soft";
export const field =
  "h-12 w-full rounded-2xl border border-os-line bg-os-bg px-4 text-base text-os-ink outline-none transition placeholder:text-os-muted/70 focus:border-os-brand focus:ring-2 focus:ring-os-brand/25";
export const label = "mb-1.5 block text-[13px] font-semibold text-os-muted";

// Header row: back button on the left, optional actions on the right.
export function TopBar({ back, children }) {
  const navigate = useNavigate();
  const t = useT();
  return (
    <header className="flex items-center justify-between gap-3">
      {back ? (
        <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(back))} aria-label={t("back")} className={iconBtn}>
          <ChevronLeft className="h-5 w-5" />
        </button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">{children}</div>
    </header>
  );
}

// Progress ring: value of total, label in the middle.
export function Ring({ value, total, size = 112, children }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const frac = total ? Math.min(value / total, 1) : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="12" className="stroke-os-brand-soft" />
        {frac > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${c * frac} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className="stroke-os-money transition-[stroke-dasharray] duration-500"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-20" role="status" aria-label="Loading">
      <span className="h-7 w-7 animate-spin rounded-full border-[3px] border-os-brand-soft border-t-os-brand" />
    </div>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-2xl bg-os-warn-soft px-4 py-3 text-sm text-os-warn">
      {children}
    </p>
  );
}

export const LinkCard = ({ to, className, children }) => (
  <Link to={to} className={cn(card, "block transition hover:border-os-brand/40 active:scale-[0.99]", className)}>
    {children}
  </Link>
);

// ---------- group logic ----------

export const money = (cents, currency, lang) => formatMoney(cents, currency, lang);
export const currentRound = (g) => (g.status === "active" ? g.rounds[g.current_round - 1] ?? null : null);
export const paymentOf = (round, memberId) => round?.payments.find((p) => p.member_id === memberId);
export const iso = (d) => (d ? d.slice(0, 10) : "");

// Contributions the person still owes in the current rounds of their active groups.
export function dueItems(groups) {
  const out = [];
  for (const g of groups) {
    const r = currentRound(g);
    if (r && g.you && !paymentOf(r, g.you.id)) out.push({ g, r });
  }
  return out.sort((a, b) => iso(a.r.date).localeCompare(iso(b.r.date)));
}

// The person's earliest round still to be paid out (their next pot).
export function nextPayout(groups) {
  let best = null;
  for (const g of groups) {
    if (g.status !== "active" || !g.you) continue;
    const r = g.rounds.find((x) => x.recipient_id === g.you.id && !x.paid_out);
    if (r && (!best || iso(r.date) < iso(best.r.date))) best = { g, r };
  }
  return best;
}

// Groups the person organizes with "I paid" waiting for confirmation.
export function toConfirm(groups) {
  return groups
    .filter((g) => g.role === "organizer")
    .map((g) => ({ g, n: currentRound(g)?.payments.filter((p) => p.status === "sent").length ?? 0 }))
    .filter((x) => x.n > 0);
}

export function dueText(date, t, lang, formatDate) {
  const n = daysUntil(iso(date));
  if (n === null) return { text: "", tone: "muted" };
  if (n < 0) return { text: t("osLate", { n: -n }), tone: "warn" };
  if (n === 0) return { text: t("osDueToday"), tone: "warn" };
  if (n === 1) return { text: t("osDueTomorrow"), tone: "warn" };
  if (n <= 7) return { text: t("osDueIn", { n }), tone: "warn" };
  return { text: t("osDueOn", { date: formatDate(iso(date), lang) }), tone: "muted" };
}
