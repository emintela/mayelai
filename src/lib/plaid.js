// Plaid Link: Plaid's own window where people pick their bank and sign in.
// Mayel'AI never sees bank passwords; it gets a one-time token to exchange.

const SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
let loading;

function loadPlaid() {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => (window.Plaid ? resolve(window.Plaid) : reject(new Error("Plaid didn't load.")));
    s.onerror = () => {
      loading = null;
      reject(new Error("Couldn't reach Plaid. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

// Opens Link. Resolves { publicToken, institution: {id, name} } when the person
// connects, or null when they close it.
export async function openPlaidLink(linkToken) {
  const Plaid = await loadPlaid();
  return new Promise((resolve, reject) => {
    let handler;
    try {
      handler = Plaid.create({
        token: linkToken,
        onSuccess: (publicToken, metadata) => {
          resolve({
            publicToken,
            institution: { id: metadata?.institution?.institution_id || "", name: metadata?.institution?.name || "" },
          });
          handler.destroy();
        },
        onExit: (err) => {
          handler.destroy();
          if (err && err.error_code && err.error_code !== "USER_CANCELLED") reject(new Error(err.display_message || err.error_message || "Plaid closed."));
          else resolve(null);
        },
      });
    } catch (e) {
      reject(e);
      return;
    }
    handler.open();
  });
}
