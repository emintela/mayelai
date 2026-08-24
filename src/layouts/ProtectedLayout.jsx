import { Outlet } from "react-router-dom";
import { SignedIn, SignedOut, RedirectToSignIn } from "@clerk/clerk-react";
import DashboardLayout from "./DashboardLayout";

const ProtectedLayout = () => {
  return (
    <>
      <SignedIn>
        <DashboardLayout>
          <Outlet />
        </DashboardLayout>
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
};

export default ProtectedLayout;
