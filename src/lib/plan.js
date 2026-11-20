// In "My Finances" chats Mayele can end a reply with
//   <plan>{"title":"…","budgets":[{"category":"FOOD_AND_DRINK","amount":350}]}</plan>
// The block is hidden from the text; onSave's chat shows it as a card that creates the budgets.

const BUDGETABLE = new Set([
  "TOTAL", "FOOD_AND_DRINK", "RENT_AND_UTILITIES", "TRANSPORTATION", "GENERAL_MERCHANDISE", "ENTERTAINMENT", "PERSONAL_CARE",
  "MEDICAL", "TRAVEL", "HOME_IMPROVEMENT", "GENERAL_SERVICES", "GOVERNMENT_AND_NON_PROFIT", "BANK_FEES", "OTHER",
]);

// Names the model sometimes uses instead of the codes.
const ALIAS = {
  SHOPPING: "GENERAL_MERCHANDISE", FOOD: "FOOD_AND_DRINK", DINING: "FOOD_AND_DRINK", GROCERIES: "FOOD_AND_DRINK",
  HOUSING: "RENT_AND_UTILITIES", RENT: "RENT_AND_UTILITIES", UTILITIES: "RENT_AND_UTILITIES", BILLS: "RENT_AND_UTILITIES",
  TRANSPORT: "TRANSPORTATION", HEALTH: "MEDICAL", SERVICES: "GENERAL_SERVICES", FEES: "BANK_FEES", ALL: "TOTAL",
};

function readPlan(json) {
  try {
    const p = JSON.parse(json);
    const seen = new Set();
    const budgets = (Array.isArray(p?.budgets) ? p.budgets : [])
      .map((b) => {
        const c = String(b?.category || "").toUpperCase().replace(/&/g, " AND ").trim().replace(/[\s-]+/g, "_");
        return { category: ALIAS[c] || c, amount_cents: Math.round(Number(b?.amount) * 100) };
      })
      .filter((b) => BUDGETABLE.has(b.category) && Number.isFinite(b.amount_cents) && b.amount_cents > 0 && !seen.has(b.category) && seen.add(b.category));
    if (!budgets.length) return null;
    budgets.sort((a, b) => (a.category === "TOTAL" ? -1 : b.category === "TOTAL" ? 1 : b.amount_cents - a.amount_cents));
    return { title: typeof p.title === "string" ? p.title.slice(0, 80) : "", budgets };
  } catch {
    return null;
  }
}

// splitPlan returns the text without the plan block, and the plan (or null).
// While a reply is still streaming, a half-written block is hidden too.
export function splitPlan(content) {
  if (!content || !content.includes("<")) return { text: content, plan: null };
  const m = content.match(/<plan>([\s\S]*?)<\/plan>/);
  if (m) {
    const text = (content.slice(0, m.index) + content.slice(m.index + m[0].length)).trim();
    return { text, plan: readPlan(m[1]) };
  }
  let cut = content.indexOf("<plan");
  if (cut < 0) {
    const tail = content.slice(-5); // "<", "<p", … at the very end
    const i = tail.lastIndexOf("<");
    if (i >= 0 && "<plan>".startsWith(tail.slice(i))) cut = content.length - tail.length + i;
  }
  return { text: cut >= 0 ? content.slice(0, cut).trimEnd() : content, plan: null };
}
