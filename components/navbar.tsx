"use client";
import { Menu } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import Mobilesidebar from "./mobilesidebar";
import { useState, useEffect } from "react";

const Navbar = () => {
  // ✅ Fix hydration issues
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) return null; // ✅ Avoid rendering until mounted

  return (
    <div className="flex items-center p-4">
      <Mobilesidebar />
      <div className="flex w-full justify-end">
        <UserButton />
      </div>
    </div>
  );
};

export default Navbar;
