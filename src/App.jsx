import { Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";
import ProtectedLayout from "@/layouts/ProtectedLayout";
import SignInPage from "@/pages/SignInPage";
import SignUpPage from "@/pages/SignUpPage";
import ChatPage from "@/pages/chat/ChatPage";
import WebSearchPage from "@/pages/WebSearchPage";
import SettingsPage from "@/pages/SettingsPage";
import MoneyPage from "@/pages/money/MoneyPage";
import NewLoanPage from "@/pages/money/NewLoanPage";
import LoanPage from "@/pages/money/LoanPage";
import PublicLoanPage from "@/pages/money/PublicLoanPage";

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <Routes>
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/sign-in/*" element={<SignInPage />} />
        <Route path="/sign-up/*" element={<SignUpPage />} />
        {/* Shared loan link: public, no account */}
        <Route path="/l/:token" element={<PublicLoanPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/dashboard" element={<Navigate to="/chat" replace />} />
          {/* One route with an optional id so the page isn't remounted when a new chat gets its URL */}
          <Route path="/chat/:conversationId?" element={<ChatPage />} />
          <Route path="/websearch" element={<WebSearchPage />} />
          <Route path="/money" element={<MoneyPage />} />
          <Route path="/money/new" element={<NewLoanPage />} />
          <Route path="/money/:id" element={<LoanPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </ThemeProvider>
  );
}

export default App;
