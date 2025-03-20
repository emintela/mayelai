"use client";
import { Menu, Moon, Sun } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import Mobilesidebar from "./mobilesidebar";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";

const Navbar = () => {
  const { theme, setTheme } = useTheme();
  const [isMounted, setIsMounted] = useState(false);
 

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) return null;

  return (
    <div className="sticky top-0 z-50 flex items-center p-4 bg-white dark:bg-gray-900 border-b dark:border-gray-700">
      <Mobilesidebar />
      <div className="flex w-full justify-end items-center space-x-4">
        <button
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800"
        >
          {theme === "light" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </button>
        <UserButton />
      </div>
    </div>
  );
};

export default Navbar;