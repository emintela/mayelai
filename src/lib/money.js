// Money helpers shared by the Money pages.

export const CURRENCIES = ["USD", "EUR", "CAD"];
export const METHODS = ["Zelle", "Cash App", "Interac", "M-Pesa", "Orange Money", "Airtel Money", "Cash", "Bank transfer", "Other"];

export function formatMoney(cents, currency, lang = "en") {
  const locale = lang === "fr" ? "fr-FR" : "en-US";
  const opts = { style: "currency", currency, currencyDisplay: currency === "CAD" ? "symbol" : "narrowSymbol" };
  if (cents % 100 === 0) opts.maximumFractionDigits = 0;
  return new Intl.NumberFormat(locale, opts).format(cents / 100);
}

export function centsToInput(cents) {
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

// Local calendar date as YYYY-MM-DD (the server uses it as "today").
export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const dayMs = 86400000;
const parseISO = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

// Days from today until the due date (negative = late).
export function daysUntil(iso) {
  if (!iso) return null;
  return Math.round((parseISO(iso) - parseISO(todayISO())) / dayMs);
}

// long = full month name, for dates inside sentences ("7 novembre", not "7 nov.").
export function formatDate(iso, lang = "en", long = false) {
  if (!iso) return "";
  return parseISO(iso.slice(0, 10)).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
    day: "numeric",
    month: long ? "long" : "short",
    year: parseISO(iso.slice(0, 10)).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

export function dueLabel(loan, t) {
  const n = daysUntil(loan.due_on);
  if (n === null) return { text: t("noDueDate"), late: false };
  if (n < 0) return { text: t("lateBy", { n: -n }), late: true };
  if (n === 0) return { text: t("dueToday"), late: false, soon: true };
  if (n === 1) return { text: t("dueTomorrow"), late: false, soon: true };
  return { text: t("dueIn", { n }), late: false, soon: n <= 3 };
}

export const shareLink = (token) => `${window.location.origin}/l/${token}`;

export function whatsappURL(phone, text) {
  const digits = (phone || "").replace(/[^0-9]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function smsURL(phone, text) {
  return `sms:${(phone || "").replace(/[^0-9+]/g, "")}?body=${encodeURIComponent(text)}`;
}

export const collectionLink = (token) => `${window.location.origin}/c/${token}`;
export const KINDS = ["funeral", "wedding", "birth", "medical", "other"];
export const groupLink = (token, memberToken) => `${window.location.origin}/g/${token}${memberToken ? `?m=${memberToken}` : ""}`;
export const FREQUENCIES = ["monthly", "biweekly", "weekly"];
export const requestLink = (token) => `${window.location.origin}/r/${token}`;

// One-tap pay links for the person paying (amount filled in where the app allows it).
export function payLinks(payTo, cents, currency, note = "") {
  if (!payTo) return [];
  const amt = (cents / 100).toFixed(2).replace(/\.00$/, "");
  const out = [];
  if (payTo.cashtag && currency === "USD")
    out.push({ name: "Cash App", handle: `$${payTo.cashtag}`, href: `https://cash.app/$${encodeURIComponent(payTo.cashtag)}/${amt}` });
  if (payTo.venmo && currency === "USD")
    out.push({
      name: "Venmo",
      handle: `@${payTo.venmo}`,
      href: `https://venmo.com/?txn=pay&audience=private&recipients=${encodeURIComponent(payTo.venmo)}&amount=${amt}&note=${encodeURIComponent(note || "onSave")}`,
    });
  if (payTo.paypal)
    out.push({ name: "PayPal", handle: `paypal.me/${payTo.paypal}`, href: `https://paypal.me/${encodeURIComponent(payTo.paypal)}/${amt}${currency}` });
  if (payTo.zelle) out.push({ name: "Zelle", handle: payTo.zelle, copy: payTo.zelle });
  if (payTo.interac) out.push({ name: "Interac", handle: payTo.interac, copy: payTo.interac });
  if (payTo.mobile_money) out.push({ name: "Mobile money", handle: payTo.mobile_money, copy: payTo.mobile_money });
  return out;
}
