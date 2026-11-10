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
