import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { Check, ShieldCheck } from "lucide-react";
import { errorText, useApi } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { METHODS, formatDate } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Avatar, ErrorNote, Spinner, TopBar, btnBrand, btnMoney, card, currentRound, money, paymentOf } from "./ui";

// The methods people use most for each currency come first.
const FIRST = {
  USD: ["Zelle", "Cash App", "Bank transfer", "Cash"],
  CAD: ["Interac", "Bank transfer", "Cash", "M-Pesa"],
  EUR: ["Bank transfer", "Orange Money", "Cash", "M-Pesa"],
};

export default function Pay() {
  const { id } = useParams();
  const api = useApi();
  const t = useT();
  const lang = useLang();
  const { user } = useUser();
  const [g, setG] = useState(null);
  const [error, setError] = useState(null);
  const [method, setMethod] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.myGroup(id).then(setG).catch((e) => setError(errorText(e)));
  }, [api, id]);

  if (!g) return error ? <ErrorNote>{error}</ErrorNote> : <Spinner />;

  const round = currentRound(g);
  const mine = round && g.you ? paymentOf(round, g.you.id) : null;
  const amount = money(g.amount_cents, g.currency, lang);
  const owner = g.owner_name || t("osOrganizer");
  const first = FIRST[g.currency] ?? [];
  const methods = [...first, ...METHODS.filter((m) => !first.includes(m))];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setG(await api.payMine(g.id, round.number, method));
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="flex h-28 w-28 items-center justify-center rounded-full bg-os-money-soft">
            <span className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-os-btn-money text-white">
              <Check className="h-10 w-10" strokeWidth={2.6} />
            </span>
          </div>
          <h1 className="os-display text-[26px] font-extrabold">{t("osThanks", { name: user?.firstName || g.you?.name || "" })}</h1>
          <p className="max-w-xs text-[15px] leading-relaxed text-os-muted">
            {method ? t("osThanksBodyMethod", { owner, amount, method }) : t("osThanksBody", { owner, amount })}
          </p>
        </div>
        <Link to="/onsave" className={cn(btnBrand, "h-14 w-full text-base")}>
          {t("osBackHome")}
        </Link>
      </div>
    );

  if (!round || !g.you || mine)
    return (
      <div className="space-y-4 pt-2">
        <TopBar back={`/onsave/groups/${id}`} />
        <p className={cn(card, "p-5 text-center text-sm text-os-muted")}>
          {mine?.status === "received" ? t("osYouConfirmed", { owner }) : mine ? t("osYouSent", { owner }) : t("osNothingToPay")}
        </p>
        <Link to={`/onsave/groups/${id}`} className={cn(btnBrand, "w-full")}>
          {g.name}
        </Link>
      </div>
    );

  return (
    <div className="flex flex-1 flex-col gap-5 pt-2">
      <div className="flex items-center gap-3">
        <TopBar back={`/onsave/groups/${id}`} />
        <p className="min-w-0 truncate text-[15px] font-semibold">
          {g.name} · {t("osRoundShort", { n: round.number })}
        </p>
      </div>

      <section className="pb-1 pt-4 text-center">
        <p className="text-sm text-os-muted">{t("osYourPayment")}</p>
        <p className="os-display mt-1.5 text-[52px] font-extrabold leading-none tracking-tight">{amount}</p>
        <div className="mt-4 inline-flex max-w-full items-center gap-2.5 rounded-full border border-os-line bg-os-card py-1.5 pl-1.5 pr-4">
          <Avatar name={round.recipient_name} size={30} />
          <span className="truncate text-sm">
            {t("osTo", { name: round.recipient_name })} · {formatDate(round.date.slice(0, 10), lang)}
          </span>
        </div>
      </section>

      <section className="space-y-2.5">
        <h2 className="text-[15px] font-bold">{t("osPayHow")}</h2>
        <div className="grid grid-cols-2 gap-2.5">
          {methods.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={method === m}
              onClick={() => setMethod((cur) => (cur === m ? "" : m))}
              className={cn(
                "min-h-14 rounded-2xl border-2 px-3.5 text-left text-sm font-semibold transition",
                method === m ? "border-os-brand bg-os-brand-soft text-os-brand-ink" : "border-os-line bg-os-card text-os-ink hover:border-os-brand/40"
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </section>

      <div className="flex-1" />
      <ErrorNote>{error}</ErrorNote>
      <p className={cn(card, "flex gap-2.5 rounded-2xl p-3.5 text-[13px] leading-relaxed text-os-muted")}>
        <ShieldCheck className="mt-0.5 h-[18px] w-[18px] shrink-0 text-os-brand" aria-hidden="true" />
        {t("osPayNote", { owner })}
      </p>
      <button type="button" disabled={busy} onClick={submit} className={cn(btnMoney, "h-14 w-full text-base")}>
        <Check className="h-5 w-5" strokeWidth={2.6} /> {t("osPayButton", { amount })}
      </button>
    </div>
  );
}
