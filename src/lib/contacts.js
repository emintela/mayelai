// Picking people from the phone's contacts, through the browser's Contact
// Picker (Chrome on Android today). Other browsers don't offer it, so callers
// hide the button there and people type the name and number instead.

export function canPickContacts() {
  return typeof navigator !== "undefined" && "contacts" in navigator && typeof navigator.contacts?.select === "function";
}

// Cleans a number for our fields: keeps + and digits, max 24 characters.
function cleanPhone(raw) {
  const s = (raw || "").trim();
  const plus = s.startsWith("+") ? "+" : "";
  const digits = s.replace(/[^0-9]/g, "");
  return digits.length >= 6 ? (plus + digits).slice(0, 24) : ""; // too short to be a real number
}

// Opens the picker and returns [{ name, phone }]; [] if the person cancels.
export async function pickContacts({ multiple = false } = {}) {
  if (!canPickContacts()) return [];
  let picked;
  try {
    picked = await navigator.contacts.select(["name", "tel"], { multiple });
  } catch {
    return []; // cancelled or blocked
  }
  return (picked || [])
    .map((c) => {
      const phone = cleanPhone(c.tel?.[0]);
      const name = (c.name?.[0] || "").trim().slice(0, 80) || phone;
      return { name, phone };
    })
    .filter((c) => c.name);
}
