import { Link } from "react-router-dom";

// Public privacy policy and terms. Linked from Google's sign-in screen, so no account needed.

const CONTACT = "hello@mayelai.com";
const UPDATED = "November 20, 2026";

function Shell({ title, children }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
        <Link to="/" className="text-sm font-semibold text-primary">
          ← Mayel&apos;AI
        </Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Last updated {UPDATED}</p>
        <div className="mt-8 space-y-6 text-[15px] leading-relaxed [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
          {children}
        </div>
        <p className="mt-12 border-t pt-6 text-sm text-muted-foreground">
          <Link to="/privacy" className="hover:underline">Privacy</Link> ·{" "}
          <Link to="/terms" className="hover:underline">Terms</Link> ·{" "}
          <a href={`mailto:${CONTACT}`} className="hover:underline">{CONTACT}</a>
        </p>
      </div>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <Shell title="Privacy Policy">
      <p>
        This policy explains what Mayel&apos;AI (including the onSave app at mayelai.com) collects, why, and the choices you have.
        We collect only what we need to run the service, and we never sell your data.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Account:</b> your name, email address and profile picture when you sign up, including through Google sign-in.</li>
        <li><b>Chats:</b> the messages and files you send to the Mayele assistant, and its answers, so you can see your history.</li>
        <li><b>Money records:</b> savings groups, loans, requests and collections you create: names, amounts, dates and notes you enter. Mayel&apos;AI keeps records only; it does not hold or move money.</li>
        <li><b>Bank accounts you connect (AI Fin):</b> through Plaid, with your permission, we receive read-only account names, balances and transactions. We never see your bank password and can never move money. Disconnect a bank at any time in AI Fin and we delete its data.</li>
        <li><b>Contacts you choose:</b> when you pick people from your phone, we receive only the names and phone numbers you select, never your whole address book.</li>
        <li><b>Payment handles:</b> Cash App, Venmo, PayPal or similar handles you add so people can pay you.</li>
        <li><b>Notifications:</b> if you turn on alerts, a technical address from your browser used to send them.</li>
        <li><b>Billing:</b> if you subscribe, payment is handled by Stripe; we never see your full card number.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To run the app: show your chats, groups and records, and send the requests and reminders you ask for.</li>
        <li>To show your balances, spending and tips in AI Fin.</li>
        <li>To answer your questions with AI. Chat messages are processed by OpenAI, and web searches by SerpAPI.</li>
        <li>To keep the service secure and prevent abuse.</li>
      </ul>

      <h2>Who processes data for us</h2>
      <ul>
        <li>Clerk (sign-in and accounts)</li>
        <li>Plaid (bank connections; see plaid.com/legal for how Plaid handles your data)</li>
        <li>OpenAI (AI answers) and SerpAPI (web search)</li>
        <li>Neon (database) and Fly.io (hosting), in the European Union</li>
        <li>Stripe (payments)</li>
      </ul>
      <p>These providers process data only to deliver their part of the service.</p>

      <h2>Sharing</h2>
      <p>
        When you send a request or invite, the people you send it to see what you included (your name, the amount and your note).
        We don&apos;t share your data with anyone else except when the law requires it.
      </p>

      <h2>Cookies and storage</h2>
      <p>We use cookies needed for sign-in, and your browser&apos;s storage for preferences such as language and theme. No advertising trackers.</p>

      <h2>Your choices</h2>
      <ul>
        <li>Delete any chat, or all of them, from the app.</li>
        <li>Turn notifications off at any time.</li>
        <li>Ask us for a copy of your data, to correct it, or to delete your account by writing to {CONTACT}.</li>
      </ul>

      <h2>Keeping data</h2>
      <p>We keep your data while your account is open. When you delete your account, we delete your data within 30 days, except where the law requires us to keep it.</p>

      <h2>Children</h2>
      <p>Mayel&apos;AI is not meant for children under 16.</p>

      <h2>Changes</h2>
      <p>If we change this policy in an important way, we&apos;ll tell you in the app.</p>

      <h2>Contact</h2>
      <p>Questions: <a href={`mailto:${CONTACT}`} className="font-semibold text-primary">{CONTACT}</a></p>
    </Shell>
  );
}

export function TermsPage() {
  return (
    <Shell title="Terms of Service">
      <p>By using Mayel&apos;AI (including the onSave app at mayelai.com), you agree to these terms.</p>

      <h2>The service</h2>
      <p>
        Mayel&apos;AI offers an AI assistant and tools to organize savings groups, loans, requests and collections between people you know.
        It keeps records and sends messages for you. It is not a bank, does not hold or transfer money, and is not a party to any agreement between members.
      </p>

      <h2>Your account</h2>
      <p>You are responsible for your account and for what you do with it. Give accurate information and keep your sign-in secure.</p>

      <h2>Acceptable use</h2>
      <ul>
        <li>No illegal activity, fraud, harassment or spam.</li>
        <li>Only add people who agreed to hear from you.</li>
        <li>Don&apos;t try to break, overload or misuse the service.</li>
      </ul>

      <h2>AI answers</h2>
      <p>AI answers can be wrong. Don&apos;t rely on them alone for financial, legal or medical decisions.</p>

      <h2>Money between people</h2>
      <p>Agreements and payments between members are their own responsibility. We are not liable for unpaid contributions, loans or disputes.</p>

      <h2>Paid plans</h2>
      <p>Paid plans renew until cancelled. You can cancel at any time in Settings; it takes effect at the end of the billing period.</p>

      <h2>Ending use</h2>
      <p>You can stop using the service at any time. We may suspend accounts that break these terms.</p>

      <h2>No warranty</h2>
      <p>The service is provided &quot;as is&quot;. To the extent the law allows, we are not liable for indirect losses or for losses beyond what you paid us in the last 12 months.</p>

      <h2>Changes</h2>
      <p>We may update these terms and will tell you in the app about important changes.</p>

      <h2>Contact</h2>
      <p><a href={`mailto:${CONTACT}`} className="font-semibold text-primary">{CONTACT}</a></p>
    </Shell>
  );
}
