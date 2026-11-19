// Picking people from the phone's contacts.
// - In the onSave phone app (iPhone and Android): the native contact picker.
// - On the web: the browser's Contact Picker (Chrome on Android today).
// Elsewhere callers hide the button and people type the name and number.
import { isNativeApp } from "./native";

export function canPickContacts() {
  if (isNativeApp()) return true;
  return typeof navigator !== "undefined" && "contacts" in navigator && typeof navigator.contacts?.select === "function";
}

// Cleans a number for our fields: keeps + and digits, max 24 characters.
function cleanPhone(raw) {
  const s = (raw || "").trim();
  const plus = s.startsWith("+") ? "+" : "";
  const digits = s.replace(/[^0-9]/g, "");
  return digits.length >= 6 ? (plus + digits).slice(0, 24) : ""; // too short to be a real number
}

const clip = (name, phone) => ({ name: (name || "").trim().slice(0, 80) || phone, phone });

// The native picker shows the phone's own contact list and returns one person.
// It needs no access to the whole address book.
async function pickNative() {
  const { Contacts } = await import("@capacitor-community/contacts");
  let res;
  try {
    res = await Contacts.pickContact({ projection: { name: true, phones: true } });
  } catch {
    return []; // cancelled
  }
  const c = res?.contact;
  if (!c) return [];
  const phones = c.phones || [];
  const best = phones.find((p) => p.type === "mobile") || phones.find((p) => p.isPrimary) || phones[0];
  const phone = cleanPhone(best?.number);
  const n = c.name || {};
  const name = n.display || [n.given, n.family].filter(Boolean).join(" ");
  const person = clip(name, phone);
  return person.name ? [person] : [];
}

// Opens the picker and returns [{ name, phone }]; [] if the person cancels.
// The native picker returns one person per tap, even when `multiple` is asked.
export async function pickContacts({ multiple = false } = {}) {
  if (isNativeApp()) return pickNative();
  if (!canPickContacts()) return [];
  let picked;
  try {
    picked = await navigator.contacts.select(["name", "tel"], { multiple });
  } catch {
    return []; // cancelled or blocked
  }
  return (picked || []).map((c) => clip(c.name?.[0], cleanPhone(c.tel?.[0]))).filter((c) => c.name);
}
