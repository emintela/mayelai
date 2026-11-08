import { Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";
import ProtectedLayout from "@/layouts/ProtectedLayout";
import SignInPage from "@/pages/SignInPage";
import SignUpPage from "@/pages/SignUpPage";
import ChatPage from "@/pages/chat/ChatPage";
import WebSearchPage from "@/pages/WebSearchPage";
import SettingsPage from "@/pages/SettingsPage";

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <Routes>
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/sign-in/*" element={<SignInPage />} />
        <Route path="/sign-up/*" element={<SignUpPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/dashboard" element={<Navigate to="/chat" replace />} />
          {/* One route with an optional id so the page isn't remounted when a new chat gets its URL */}
          <Route path="/chat/:conversationId?" element={<ChatPage />} />
          <Route path="/websearch" element={<WebSearchPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </ThemeProvider>
  );
}

export default App;
