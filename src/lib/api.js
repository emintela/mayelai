import { useMemo, useRef } from "react";
import axios from "axios";
import { useAuth } from "@clerk/clerk-react";

// useApi returns functions for calling the backend with the user's Clerk token.
export function useApi() {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  return useMemo(() => {
    const request = async (method, url, { data, params } = {}) => {
      const token = await getTokenRef.current();
      const res = await axios({
        method,
        url,
        data,
        params,
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.data;
    };
    const conv = (id) => `/api/conversations/${encodeURIComponent(id)}`;

    return {
      // attachments: [{ name, type, data (base64) }]
      sendMessage: ({ conversationId, message, mode, attachments }) =>
        request("post", "/api/chat", { data: { conversationId, message, mode, attachments } }),
      listConversations: (q) =>
        request("get", "/api/conversations", { params: q ? { q } : undefined }),
      getConversation: (id) => request("get", conv(id)),
      deleteConversation: (id) => request("delete", conv(id)),
      deleteAllConversations: () => request("delete", "/api/conversations"),
      getUsage: () => request("get", "/api/usage"),
      // Money (IOU tracker)
      listLoans: (status) => request("get", "/api/money/loans", { params: status ? { status } : undefined }),
      createLoan: (loan) => request("post", "/api/money/loans", { data: loan }),
      parseLoan: (text, today) => request("post", "/api/money/parse", { data: { text, today } }),
      getLoan: (id) => request("get", `/api/money/loans/${encodeURIComponent(id)}`),
      updateLoan: (id, patch) => request("patch", `/api/money/loans/${encodeURIComponent(id)}`, { data: patch }),
      deleteLoan: (id) => request("delete", `/api/money/loans/${encodeURIComponent(id)}`),
      addPayment: (id, payment) => request("post", `/api/money/loans/${encodeURIComponent(id)}/payments`, { data: payment }),
      deletePayment: (id, pid) =>
        request("delete", `/api/money/loans/${encodeURIComponent(id)}/payments/${encodeURIComponent(pid)}`),
      setLoanStatus: (id, status) => request("post", `/api/money/loans/${encodeURIComponent(id)}/status`, { data: { status } }),
      rotateLink: (id) => request("post", `/api/money/loans/${encodeURIComponent(id)}/link`),
      draftReminder: (id, body) => request("post", `/api/money/loans/${encodeURIComponent(id)}/reminders/draft`, { data: body }),
      logReminder: (id, body) => request("post", `/api/money/loans/${encodeURIComponent(id)}/reminders`, { data: body }),
      // Collections (family events)
      listCollections: () => request("get", "/api/money/collections"),
      createCollection: (c) => request("post", "/api/money/collections", { data: c }),
      getCollection: (id) => request("get", `/api/money/collections/${encodeURIComponent(id)}`),
      updateCollection: (id, patch) => request("patch", `/api/money/collections/${encodeURIComponent(id)}`, { data: patch }),
      deleteCollection: (id) => request("delete", `/api/money/collections/${encodeURIComponent(id)}`),
      setCollectionStatus: (id, status) =>
        request("post", `/api/money/collections/${encodeURIComponent(id)}/status`, { data: { status } }),
      rotateCollectionLink: (id) => request("post", `/api/money/collections/${encodeURIComponent(id)}/link`),
      addContribution: (id, c) => request("post", `/api/money/collections/${encodeURIComponent(id)}/contributions`, { data: c }),
      setContributionStatus: (id, cid, status) =>
        request("post", `/api/money/collections/${encodeURIComponent(id)}/contributions/${encodeURIComponent(cid)}/status`, {
          data: { status },
        }),
      deleteContribution: (id, cid) =>
        request("delete", `/api/money/collections/${encodeURIComponent(id)}/contributions/${encodeURIComponent(cid)}`),
      markReminded: (id, cid) =>
        request("post", `/api/money/collections/${encodeURIComponent(id)}/contributions/${encodeURIComponent(cid)}/reminded`),
      collectionDraft: (id, body) => request("post", `/api/money/collections/${encodeURIComponent(id)}/draft`, { data: body }),
      // Likelemba groups
      listGroups: () => request("get", "/api/money/groups"),
      createGroup: (body) => request("post", "/api/money/groups", { data: body }),
      getGroup: (id) => request("get", `/api/money/groups/${encodeURIComponent(id)}`),
      updateGroup: (id, patch) => request("patch", `/api/money/groups/${encodeURIComponent(id)}`, { data: patch }),
      deleteGroup: (id) => request("delete", `/api/money/groups/${encodeURIComponent(id)}`),
      groupAction: (id, action, body) => request("post", `/api/money/groups/${encodeURIComponent(id)}/${action}`, { data: body }),
      removeMember: (id, mid) => request("delete", `/api/money/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(mid)}`),
      // onSave (groups I organize or belong to)
      myGroups: () => request("get", "/api/onsave/groups"),
      myGroup: (id) => request("get", `/api/onsave/groups/${encodeURIComponent(id)}`),
      payMine: (id, round, method) => request("post", `/api/onsave/groups/${encodeURIComponent(id)}/paid`, { data: { round, method } }),
      joinGroup: (token, body) => request("post", `/api/onsave/join/${encodeURIComponent(token)}`, { data: body }),
      claimMember: (token, memberToken) => request("post", "/api/onsave/claim", { data: { token, member_token: memberToken } }),
      activity: () => request("get", "/api/onsave/activity"),
      // Money requests (request / give) and how people pay you
      listRequests: () => request("get", "/api/money/requests"),
      createRequests: (body) => request("post", "/api/money/requests", { data: body }),
      getRequest: (id) => request("get", `/api/money/requests/${encodeURIComponent(id)}`),
      requestAction: (id, action, today) =>
        request("post", `/api/money/requests/${encodeURIComponent(id)}/${action}`, { params: today ? { today } : undefined }),
      claimRequest: (token) => request("post", "/api/money/requests/claim", { data: { token } }),
      getPayProfile: () => request("get", "/api/money/profile"),
      savePayProfile: (p) => request("put", "/api/money/profile", { data: p }),
      // Push alerts
      pushKey: () => request("get", "/api/push/key"),
      pushSubscribe: (subscription, lang) => request("post", "/api/push/subscribe", { data: { subscription, lang } }),
      pushUnsubscribe: (endpoint) => request("post", "/api/push/unsubscribe", { data: { endpoint } }),
      pushTest: () => request("post", "/api/push/test"),
      pushDevice: (token, platform, lang) => request("post", "/api/push/device", { data: { token, platform, lang } }),
      finOverview: (today) => request("get", "/api/fin", { params: { today } }),
      finLinkToken: (itemId, lang) => request("post", "/api/fin/link-token", { data: { item_id: itemId || "", lang } }),
      finConnect: (publicToken, institution, today) =>
        request("post", "/api/fin/connect", { data: { public_token: publicToken, institution: institution || { id: "", name: "" }, today } }),
      finRefresh: (today) => request("post", "/api/fin/refresh", { data: { today } }),
      finTransactions: (params) => request("get", "/api/fin/transactions", { params }),
      finBudgets: (month, today) => request("get", "/api/fin/budgets", { params: { month, today } }),
      finSetBudget: (category, amountCents) => request("put", "/api/fin/budgets", { data: { category, amount_cents: amountCents } }),
      finDeleteBudget: (category) => request("delete", `/api/fin/budgets/${encodeURIComponent(category)}`),
      finSuggestBudgets: (cut, today) => request("post", "/api/fin/budgets/suggest", { data: { cut, today } }),
      finTips: (today) => request("get", "/api/fin/tips", { params: { today } }),
      finAlerts: () => request("get", "/api/fin/alerts"),
      finAlertsRead: () => request("post", "/api/fin/alerts/read"),
      finSaveAlertSettings: (settings) => request("put", "/api/fin/alert-settings", { data: settings }),
      finDisconnect: (id) => request("delete", `/api/fin/banks/${encodeURIComponent(id)}`),
      pushDeviceRemove: (token) => request("post", "/api/push/device/remove", { data: { token } }),
      getBilling: () => request("get", "/api/billing"),
      startCheckout: () => request("post", "/api/billing/checkout"),
      openPortal: () => request("post", "/api/billing/portal"),
      setFeedback: (messageId, value) =>
        request("put", `/api/messages/${messageId}/feedback`, { data: { value } }),
    };
  }, []);
}

// apiErrorMessage turns an axios error into a message to show the user.
export function apiErrorMessage(err) {
  const msg = err?.response?.data?.error;
  return `⚠️ ${msg || "Something went wrong. Please try again."}`;
}

// formatPrice turns a Stripe price ({ amount, currency, interval }) into "$5.00 / month".
export function formatPrice(price) {
  if (!price) return null;
  const amount = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: price.currency.toUpperCase(),
  }).format(price.amount / 100);
  if (!price.interval) return amount;
  const every = price.intervalCount > 1 ? `${price.intervalCount} ${price.interval}s` : price.interval;
  return `${amount} / ${every}`;
}

// Public loan link (no account): plain requests without a token.
export const publicLoanApi = {
  get: (token) => axios.get(`/api/public/loans/${encodeURIComponent(token)}`).then((r) => r.data),
  respond: (token, response, note) =>
    axios.post(`/api/public/loans/${encodeURIComponent(token)}/respond`, { response, note }).then((r) => r.data),
};

export const publicCollectionApi = {
  get: (token) => axios.get(`/api/public/collections/${encodeURIComponent(token)}`).then((r) => r.data),
  pledge: (token, c) => axios.post(`/api/public/collections/${encodeURIComponent(token)}/pledge`, c).then((r) => r.data),
};

const memberHeader = (memberToken) => (memberToken ? { headers: { "X-Member-Token": memberToken } } : {});
export const publicGroupApi = {
  get: (token, memberToken) =>
    axios.get(`/api/public/groups/${encodeURIComponent(token)}`, memberHeader(memberToken)).then((r) => r.data),
  join: (token, body) => axios.post(`/api/public/groups/${encodeURIComponent(token)}/join`, body).then((r) => r.data),
  paid: (token, memberToken, round, method) =>
    axios
      .post(`/api/public/groups/${encodeURIComponent(token)}/paid`, { round, method }, memberHeader(memberToken))
      .then((r) => r.data),
};

// Money request link (no account): view and answer.
export const publicRequestApi = {
  get: (token) => axios.get(`/api/public/requests/${encodeURIComponent(token)}`).then((r) => r.data),
  act: (token, action, body = {}) =>
    axios.post(`/api/public/requests/${encodeURIComponent(token)}/${action}`, body).then((r) => r.data),
};

// Plain error text (no emoji) for forms.
export const errorText = (err) =>
  err?.response?.data?.error || (err?.response ? "Something went wrong. Please try again." : "Couldn't reach Mayel'AI. Check your connection.");
