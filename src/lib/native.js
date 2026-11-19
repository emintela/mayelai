import { Capacitor } from "@capacitor/core";

// True inside the onSave phone app (iPhone or Android), false in a browser.
export const isNativeApp = () => Capacitor.isNativePlatform();

// "ios", "android" or "web".
export const nativePlatform = () => Capacitor.getPlatform();

// Phone app only: Android's back button goes back a page, and leaves the app
// from the first one.
export async function startNativeShell() {
  if (!isNativeApp()) return;
  const { App } = await import("@capacitor/app");
  App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else App.exitApp();
  });
}
