// Personal member links remembered on this device (from ?m= or after joining
// without an account). When the person signs in, onSave links them to their
// account so the group shows up in the app.

const PREFIX = "mayelai.member.";
const CLAIMED = "mayelai.claimed.";

export function readMember(token) {
  try {
    return localStorage.getItem(PREFIX + token) || "";
  } catch {
    return "";
  }
}

export function saveMember(token, memberToken) {
  try {
    localStorage.setItem(PREFIX + token, memberToken);
  } catch {
    /* storage blocked: works for this visit only */
  }
}

// Links every remembered personal link to the signed-in account (once each).
export async function claimRemembered(api) {
  let pending = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      const token = k.slice(PREFIX.length);
      const memberToken = localStorage.getItem(k);
      if (memberToken && localStorage.getItem(CLAIMED + token) !== memberToken) pending.push([token, memberToken]);
    }
  } catch {
    return 0;
  }
  let linked = 0;
  for (const [token, memberToken] of pending) {
    try {
      await api.claimMember(token, memberToken);
      linked++;
      localStorage.setItem(CLAIMED + token, memberToken);
    } catch (err) {
      // 404 (link rotated / group deleted) or 409 (another account): don't retry.
      const st = err?.response?.status;
      if (st === 404 || st === 409) {
        try {
          localStorage.setItem(CLAIMED + token, memberToken);
        } catch {
          /* ignore */
        }
      }
    }
  }
  return linked;
}
