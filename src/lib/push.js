// Alerts: ask permission, subscribe this device, tell the server.
// - In the onSave phone app: native alerts (Apple on iPhone, Firebase on Android).
// - In a browser: Web Push. Works on Android/desktop browsers, and on iPhone
//   (iOS 16.4+) only when the site is opened from the Home Screen. The service
//   worker is registered in production builds only, so alerts can't be turned
//   on in `npm run dev`.
import { isNativeApp, nativePlatform } from "./native";

// ---------- phone app ----------

const TOKEN_KEY = "onsave.pushToken";
const savedToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const saveToken = (t) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode */
  }
};
const plugin = async () => (await import("@capacitor/push-notifications")).PushNotifications;

async function nativeState() {
  const { receive } = await (await plugin()).checkPermissions();
  if (receive === "denied") return "blocked";
  return receive === "granted" && savedToken() ? "on" : "off";
}

// Asks the phone for its push token (Apple's or Firebase's).
async function nativeToken() {
  const P = await plugin();
  let resolve, reject;
  const token = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  const handles = await Promise.all([
    P.addListener("registration", (t) => resolve(t.value)),
    P.addListener("registrationError", (e) => reject(new Error(e?.error || "Couldn't turn on alerts."))),
  ]);
  const timeout = setTimeout(() => reject(new Error("The phone didn't answer. Please try again.")), 20000);
  try {
    await P.register();
    return await token;
  } finally {
    clearTimeout(timeout);
    handles.forEach((h) => h.remove());
  }
}

async function enableNative(api, lang) {
  const { native } = await api.pushKey();
  const platform = nativePlatform();
  // Without the server's Apple/Firebase keys, registering can't work (and on
  // Android it would need the app's Firebase file), so stop here.
  if (!native?.[platform]) throw new Error("Alerts aren't available yet.");
  const P = await plugin();
  let { receive } = await P.checkPermissions();
  if (receive !== "granted") ({ receive } = await P.requestPermissions());
  if (receive !== "granted") return nativeState();
  const token = await nativeToken();
  await api.pushDevice(token, platform, lang);
  saveToken(token);
  return "on";
}

async function disableNative(api) {
  const token = savedToken();
  if (token) await api.pushDeviceRemove(token).catch(() => {});
  saveToken(null);
  await (await plugin()).unregister().catch(() => {});
  return nativeState();
}

// Opens the page an alert points to when it's tapped. Call once; returns a cleanup.
export function onAlertTap(navigate) {
  if (!isNativeApp()) return () => {};
  let handle;
  plugin().then((P) => {
    handle = P.addListener("pushNotificationActionPerformed", ({ notification }) => {
      const url = notification?.data?.url;
      if (typeof url === "string" && url.startsWith("/")) navigate(url);
    });
  });
  return () => Promise.resolve(handle).then((h) => h?.remove());
}

const isIOS = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () =>
  typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);

// "on" | "off" | "blocked" | "ios-install" (iPhone, not opened from Home Screen) | "unsupported"
export async function pushState() {
  if (isNativeApp()) return nativeState();
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
  if (isNativeApp()) return enableNative(api, lang);
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
  if (isNativeApp()) return disableNative(api);
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
    if (isNativeApp()) {
      // Tokens can change (app update, restore): send the current one.
      if ((await nativeState()) !== "on") return;
      const token = await nativeToken();
      const old = savedToken();
      await api.pushDevice(token, nativePlatform(), lang);
      if (old && old !== token) await api.pushDeviceRemove(old).catch(() => {});
      saveToken(token);
      return;
    }
    if ((await pushState()) !== "on") return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await api.pushSubscribe(sub.toJSON(), lang);
  } catch {
    /* best effort */
  }
}
