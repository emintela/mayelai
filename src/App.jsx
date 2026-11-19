import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";
import ProtectedLayout from "@/layouts/ProtectedLayout";
import SignInPage from "@/pages/SignInPage";
import SignUpPage from "@/pages/SignUpPage";
import ChatPage from "@/pages/chat/ChatPage";
import WebSearchPage from "@/pages/WebSearchPage";
import SettingsPage from "@/pages/SettingsPage";
import NewLoanPage from "@/pages/money/NewLoanPage";
import LoanPage from "@/pages/money/LoanPage";
import PublicLoanPage from "@/pages/money/PublicLoanPage";
import CollectionsPage from "@/pages/collections/CollectionsPage";
import NewCollectionPage from "@/pages/collections/NewCollectionPage";
import CollectionPage from "@/pages/collections/CollectionPage";
import PublicCollectionPage from "@/pages/collections/PublicCollectionPage";
import OnSaveLayout from "@/onsave/OnSaveLayout";
import Welcome from "@/onsave/Welcome";
import Home from "@/onsave/Home";
import Groups from "@/onsave/Groups";
import GroupDetail from "@/onsave/GroupDetail";
import Pay from "@/onsave/Pay";
import Create from "@/onsave/Create";
import Activity from "@/onsave/Activity";
import Me from "@/onsave/Me";
import Invite from "@/onsave/Invite";
import FamilyMoney from "@/onsave/FamilyMoney";
import MoneyHome from "@/onsave/money/MoneyHome";
import MoneyFlow from "@/onsave/money/MoneyFlow";
import RequestDetail from "@/onsave/money/RequestDetail";
import RequestReply from "@/onsave/money/RequestReply";
import Ask from "@/onsave/ask/Ask";

// Old Likelemba addresses now open in onSave.
function OldGroup() {
  const { id } = useParams();
  return <Navigate to={`/onsave/groups/${id}`} replace />;
}

// Money and Collections now live inside onSave; old addresses still work.
function MovedToOnSave({ base }) {
  const { id } = useParams();
  return <Navigate to={`/onsave/${base}${id ? `/${id}` : ""}`} replace />;
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <Routes>
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/sign-in/*" element={<SignInPage />} />
        <Route path="/sign-up/*" element={<SignUpPage />} />
        {/* Shared loan link: public, no account */}
        <Route path="/l/:token" element={<PublicLoanPage />} />
        <Route path="/c/:token" element={<PublicCollectionPage />} />
        <Route path="/g/:token" element={<Invite />} />
        {/* Money request link: answer without an account */}
        <Route path="/r/:token" element={<RequestReply />} />
        {/* onSave: the likelemba app (its own mobile layout, no chat sidebar) */}
        <Route path="/onsave/welcome" element={<Welcome />} />
        <Route path="/onsave" element={<OnSaveLayout />}>
          <Route index element={<Home />} />
          <Route path="groups" element={<Groups />} />
          <Route path="groups/:id" element={<GroupDetail />} />
          <Route path="groups/:id/pay" element={<Pay />} />
          <Route path="new" element={<Create />} />
          <Route path="activity" element={<Activity />} />
          <Route path="me" element={<Me />} />
          {/* Money and Collections, as part of onSave */}
          <Route path="ask/:conversationId?" element={<Ask />} />
          <Route path="money" element={<MoneyHome />} />
          <Route path="money/send" element={<MoneyFlow />} />
          <Route path="money/requests/:id" element={<RequestDetail />} />
          <Route element={<FamilyMoney />}>
            <Route path="money/new" element={<NewLoanPage />} />
            <Route path="money/:id" element={<LoanPage />} />
            <Route path="collections" element={<CollectionsPage />} />
            <Route path="collections/new" element={<NewCollectionPage />} />
            <Route path="collections/:id" element={<CollectionPage />} />
          </Route>
        </Route>
        <Route path="/money" element={<MovedToOnSave base="money" />} />
        <Route path="/money/:id" element={<MovedToOnSave base="money" />} />
        <Route path="/collections" element={<MovedToOnSave base="collections" />} />
        <Route path="/collections/:id" element={<MovedToOnSave base="collections" />} />
        <Route path="/likelemba" element={<Navigate to="/onsave" replace />} />
        <Route path="/likelemba/new" element={<Navigate to="/onsave/new" replace />} />
        <Route path="/likelemba/:id" element={<OldGroup />} />
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
