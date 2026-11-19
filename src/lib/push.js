// Web push alerts: ask permission, subscribe this browser, tell the server.
// Works on Android/desktop browsers, and on iPhone (iOS 16.4+) only when the
// app is opened from the Home Screen. The service worker is registered in
// production builds only, so alerts can't be turned on in `npm run dev`.

const isIOS = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () =>
  typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);

// "on" | "off" | "blocked" | "ios-install" (iPhone, not opened from Home Screen) | "unsupported"
export async function pushState() {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return isIOS() && !standalone() ? "ios-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// Turns alerts on and returns the new pushState().
export async function enablePush(api, lang) {
  const { enabled, key } = await api.pushKey();
  if (!enabled || !key) throw new Error("Alerts aren't available yet.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return pushState();
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  await api.pushSubscribe(sub.toJSON(), lang);
  return "on";
}

export async function disablePush(api) {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  }
  return pushState();
}

// Keeps the server's copy (and its language) fresh when alerts are already on.
export async function refreshPush(api, lang) {
  try {
    if ((await pushState()) !== "on") return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await api.pushSubscribe(sub.toJSON(), lang);
  } catch {
    /* best effort */
  }
}
