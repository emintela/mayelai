import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, CheckCircle2, Loader2, Settings, Sparkles, Trash2 } from "lucide-react";
import Heading from "@/components/heading";
import { apiErrorMessage, formatPrice, useApi } from "@/lib/api";
import { useConversations } from "@/context/ConversationsContext";
import { cn } from "@/lib/utils";

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";

const limitText = (n, noun) => (n === 0 ? `Unlimited ${noun}` : `${n} ${noun} per day`);

const Card = ({ title, children, className }) => (
  <section className={cn("rounded-2xl border border-border bg-card p-6 shadow-sm", className)}>
    {title && <h2 className="mb-4 text-lg font-semibold">{title}</h2>}
    {children}
  </section>
);

const UsageBar = ({ label, used, limit }) => {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {used} / {limit > 0 ? limit : "∞"}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", pct >= 90 ? "bg-rose-500" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

const PlanColumn = ({ name, price, limits, features, highlight, children }) => (
  <div
    className={cn(
      "flex flex-col rounded-xl border p-5",
      highlight ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border"
    )}
  >
    <div className="flex items-center gap-2">
      {highlight && <Sparkles className="h-4 w-4 text-primary" />}
      <h3 className="font-semibold">{name}</h3>
    </div>
    <p className="mt-1 text-2xl font-bold">{price}</p>
    <ul className="mt-4 flex-1 space-y-2 text-sm">
      {[limitText(limits.messages, "messages"), limitText(limits.searches, "AI web searches"), ...features].map(
        (f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {f}
          </li>
        )
      )}
    </ul>
    {children && <div className="mt-5">{children}</div>}
  </div>
);

const SettingsPage = () => {
  const api = useApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { removeAll } = useConversations();
  const [billing, setBilling] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [activating, setActivating] = useState(params.get("checkout") === "success");
  const checkoutResult = params.get("checkout");

  const load = useCallback(async () => {
    try {
      const data = await api.getBilling();
      setBilling(data);
      setLoadError(null);
      return data;
    } catch (err) {
      setLoadError(apiErrorMessage(err));
      return null;
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  // After paying, Stripe redirects here before its webhook may have reached us:
  // poll for up to ~30s until the plan shows as Pro.
  useEffect(() => {
    if (!activating) return;
    let tries = 0;
    const timer = setInterval(async () => {
      const data = await load();
      if (data?.subscription?.plan === "pro" || ++tries >= 15) {
        clearInterval(timer);
        setActivating(false);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [activating, load]);

  const go = async (action) => {
    setBusy(true);
    setActionError(null);
    try {
      const { url } = await action();
      window.location.assign(url); // Stripe-hosted page
    } catch (err) {
      setActionError(apiErrorMessage(err));
      setBusy(false);
    }
  };

  const clearHistory = async () => {
    if (!window.confirm("Delete ALL of your chat history? This can't be undone.")) return;
    try {
      await removeAll();
      navigate("/chat");
    } catch {
      window.alert("Couldn't clear your history. Please try again.");
    }
  };

  const sub = billing?.subscription;
  const isPro = sub?.plan === "pro";
  const price = formatPrice(billing?.price) ?? "Pro";

  return (
    <div className="flex min-h-full flex-col bg-background">
      <Heading
        title="Settings"
        description="Your plan, usage and data"
        icon={Settings}
        iconColor="text-gray-500"
        bgColor="bg-gray-500/10"
      />

      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 pb-12 lg:px-8">
        {checkoutResult === "success" && (
          <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
            {activating && !isPro ? (
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-600" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            )}
            <div className="flex-1">
              {isPro
                ? "Payment successful — welcome to Pro! 🎉"
                : activating
                  ? "Payment received. Activating your Pro plan…"
                  : "Payment received. Your plan will update shortly — refresh in a minute if it doesn't."}
            </div>
            <button onClick={() => setParams({})} className="text-muted-foreground hover:text-foreground">
              ✕
            </button>
          </div>
        )}
        {checkoutResult === "cancel" && (
          <div className="flex items-start gap-3 rounded-xl border border-border bg-muted p-4 text-sm">
            <div className="flex-1">Checkout cancelled — you haven't been charged.</div>
            <button onClick={() => setParams({})} className="text-muted-foreground hover:text-foreground">
              ✕
            </button>
          </div>
        )}

        {loadError && <p className="text-sm text-rose-500">{loadError}</p>}
        {!billing && !loadError && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {billing && (
          <>
            <Card title="Your plan">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold",
                      isPro ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                    )}
                  >
                    {isPro && <Sparkles className="h-3.5 w-3.5" />}
                    {isPro ? "Pro" : "Free"}
                  </span>
                  {isPro && sub.currentPeriodEnd && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {sub.cancelAtPeriodEnd
                        ? `Cancels on ${formatDate(sub.currentPeriodEnd)} — you keep Pro until then.`
                        : `Renews on ${formatDate(sub.currentPeriodEnd)}.`}
                    </p>
                  )}
                </div>
                {isPro && billing.enabled && (
                  <button
                    onClick={() => go(api.openPortal)}
                    disabled={busy}
                    className="rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
                  >
                    {busy ? "Opening…" : "Manage subscription"}
                  </button>
                )}
              </div>
              {sub.status === "past_due" && (
                <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  Your last payment failed. Please update your payment method to keep Pro.
                </div>
              )}
            </Card>

            <Card title="Today's usage">
              <div className="space-y-4">
                <UsageBar label="Messages" used={billing.quota.used} limit={billing.quota.limit} />
                <UsageBar label="AI web searches" used={billing.quota.searches} limit={billing.quota.searchLimit} />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Limits reset every day at midnight UTC.</p>
            </Card>

            {!isPro && (
              <Card title="Upgrade">
                <div className="grid gap-4 sm:grid-cols-2">
                  <PlanColumn name="Free" price="$0" limits={billing.limits.free} features={["Chat history"]} />
                  <PlanColumn
                    name="Pro"
                    price={price}
                    limits={billing.limits.pro}
                    features={["Chat history", "Cancel anytime"]}
                    highlight
                  >
                    {billing.enabled ? (
                      <button
                        onClick={() => go(api.startCheckout)}
                        disabled={busy}
                        className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {busy ? "Redirecting to payment…" : "Upgrade to Pro"}
                      </button>
                    ) : (
                      <p className="text-center text-sm text-muted-foreground">Payments coming soon.</p>
                    )}
                  </PlanColumn>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Secure payment by Stripe — cards, Apple Pay and Google Pay. You can cancel anytime.
                </p>
              </Card>
            )}

            {actionError && <p className="text-sm text-rose-500">{actionError}</p>}
          </>
        )}

        <Card title="Data">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">Permanently delete all of your chats.</p>
            <button
              onClick={clearHistory}
              className="inline-flex items-center gap-2 rounded-full border border-rose-500/40 px-4 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-500/10"
            >
              <Trash2 className="h-4 w-4" /> Clear all history
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default SettingsPage;
