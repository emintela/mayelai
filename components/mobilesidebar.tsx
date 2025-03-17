"use client";
import { Menu } from "lucide-react";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import Sidebar from "./sidebar";
import { useEffect, useState } from "react";

const Mobilesidebar = () => {
  // ✅ Prevents hydration errors by ensuring the component is mounted on the client
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) return null; // ✅ Avoid rendering until mounted

  return (
    <Sheet>
      {/* ✅ Fix: Use `asChild={true}` so it doesn't render an extra <button> */}
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="p-0">
        <Sidebar />
      </SheetContent>
    </Sheet>
  );
};

export default Mobilesidebar;
