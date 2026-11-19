import { Link, Navigate } from "react-router-dom";
import { SignedIn, SignedOut } from "@clerk/clerk-react";
import { useT } from "@/lib/i18n";
import { LangSwitch } from "@/pages/money/parts";
import { LogoMark, Wordmark, useOnSaveChrome } from "./ui";

// Sign-up / sign-in come back to onSave (or the given page) afterwards.
export const authURL = (kind, path = "/onsave") => `/${kind}?redirect_url=${encodeURIComponent(`${window.location.origin}${path}`)}`;

function Art() {
  const t = useT();
  const people = [
    [150, 38, "GM", "#e9c9a8", "#5a3412"],
    [247, 94, "MN", "#8c76f0", "#1b1730"],
    [150, 262, "JK", "#f3b6cc", "#6e1e3d"],
    [53, 206, "AL", "#8c76f0", "#1b1730"],
    [53, 94, "RB", "#e9c9a8", "#5a3412"],
  ];
  return (
    <svg viewBox="0 0 300 300" role="img" aria-label={t("osWelcomeArt")} className="h-auto w-full max-w-[300px]">
      <circle cx="150" cy="150" r="112" fill="none" stroke="#4a3a8e" strokeWidth="2" strokeDasharray="6 10" />
      <circle cx="150" cy="150" r="62" fill="#352873" />
      <circle cx="150" cy="150" r="46" fill="#3fc48e" />
      <circle cx="150" cy="150" r="28" fill="none" stroke="#08402b" strokeWidth="3" strokeDasharray="4 6" />
      <circle cx="150" cy="150" r="9" fill="#08402b" />
      <g fontFamily="Inter, sans-serif" fontWeight="700" fontSize="13" textAnchor="middle">
        {people.map(([x, y, txt, bg, fg]) => (
          <g key={txt}>
            <circle cx={x} cy={y} r="24" fill={bg} />
            <text x={x} y={y + 5} fill={fg}>{txt}</text>
          </g>
        ))}
        <circle cx="247" cy="206" r="28" fill="#ffffff" stroke="#3fc48e" strokeWidth="4" />
        <text x="247" y="211" fill="#241a4f">PM</text>
      </g>
      <path d="M196 150 Q 225 170 222 190" fill="none" stroke="#3fc48e" strokeWidth="3" strokeLinecap="round" />
      <path d="M214 184 l8 7 l4 -10" fill="none" stroke="#3fc48e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Welcome() {
  const t = useT();
  useOnSaveChrome();
  return (
    <>
      <SignedIn>
        <Navigate to="/onsave" replace />
      </SignedIn>
      <SignedOut>
        <div className="onsave min-h-dvh bg-os-deep! text-white">
          <div
            className="mx-auto flex min-h-dvh max-w-lg flex-col px-6 pb-10"
            style={{ paddingTop: "max(env(safe-area-inset-top), 28px)" }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <LogoMark size={30} />
                <Wordmark light />
                <span className="text-xs text-os-deep-muted">{t("osTagline")}</span>
              </div>
              <LangSwitch className="border-os-deep-line bg-transparent" />
            </div>
            <div className="flex flex-1 items-center justify-center py-8">
              <Art />
            </div>
            <div className="space-y-4">
              <h1 className="os-display whitespace-pre-line text-[34px] font-extrabold leading-[1.12] tracking-tight">{t("osWelcomeTitle")}</h1>
              <p className="text-base leading-relaxed text-os-deep-muted">{t("osWelcomeBody")}</p>
              <div className="flex gap-1.5 pb-2 pt-1" aria-hidden="true">
                <span className="h-1.5 w-6 rounded-full bg-os-mint" />
                <span className="h-1.5 w-1.5 rounded-full bg-os-deep-line" />
                <span className="h-1.5 w-1.5 rounded-full bg-os-deep-line" />
              </div>
              <Link
                to={authURL("sign-up")}
                className="flex h-14 items-center justify-center rounded-full bg-white text-base font-bold text-[#241a4f] transition active:scale-[0.98]"
              >
                {t("osGetStarted")}
              </Link>
              <Link to={authURL("sign-in")} className="flex h-11 items-center justify-center text-[15px] font-semibold text-white hover:text-os-deep-muted">
                {t("osHaveAccount")}
              </Link>
            </div>
          </div>
        </div>
      </SignedOut>
    </>
  );
}
