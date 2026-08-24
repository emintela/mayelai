import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useNavigate } from "react-router-dom";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App";
import "./index.css";

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY environment variable");
}

function ClerkProviderWithRoutes({ children }) {
  const navigate = useNavigate();
  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      navigate={(to) => navigate(to)}
      appearance={{ variables: { colorPrimary: "#662d91" } }}
    >
      {children}
    </ClerkProvider>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <ClerkProviderWithRoutes>
        <App />
      </ClerkProviderWithRoutes>
    </BrowserRouter>
  </StrictMode>
);
