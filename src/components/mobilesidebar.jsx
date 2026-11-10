import { Menu } from "lucide-react";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import Sidebar from "./sidebar";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

const Mobilesidebar = () => {
  // Prevents hydration-style flash by ensuring the component is mounted on the client
  const [isMounted, setIsMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Close the sheet after navigating (e.g. tapping a chat in the history).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (!isMounted) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[85%] max-w-xs p-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
        <Sidebar />
      </SheetContent>
    </Sheet>
  );
};

export default Mobilesidebar;
