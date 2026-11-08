import Navbar from "@/components/navbar";
import Sidebar from "@/components/sidebar";
import { ConversationsProvider } from "@/context/ConversationsContext";

const DashboardLayout = ({ children }) => {
  return (
    <ConversationsProvider>
      <div className="h-full relative bg-background">
        {/* Sidebar */}
        <div
          className="hidden h-full md:flex md:w-72
            md:flex-col md:fixed md:inset-y-0 z-[80]
            bg-[#662d91]"
        >
          <Sidebar />
        </div>

        {/* Full-height column: navbar on top, page fills the rest */}
        <main className="flex h-dvh flex-col md:pl-72">
          <Navbar />
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </main>
      </div>
    </ConversationsProvider>
  );
};

export default DashboardLayout;
