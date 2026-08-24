import { Moon, Sun } from "lucide-react";
import { UserButton } from "@clerk/clerk-react";
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
    <div className="sticky top-0 z-50 flex items-center border-b border-border bg-background/80 p-4 backdrop-blur-md">
      <Mobilesidebar />
      <div className="flex w-full items-center justify-end space-x-4">
        <button
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          aria-label="Toggle theme"
          className="rounded-full p-2 transition hover:bg-accent"
        >
          {theme === "light" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </button>
        <UserButton />
      </div>
    </div>
  );
};

export default Navbar;
