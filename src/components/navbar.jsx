import { Moon, SquarePen, Sun } from "lucide-react";
import { Link } from "react-router-dom";
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
    <div className="sticky top-0 z-50 flex items-center gap-1 border-b border-border bg-background/80 px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-md md:p-4">
      <Mobilesidebar />
      <Link to="/chat" className="flex items-center gap-2 md:hidden">
        <img alt="" src="/logo1.png" className="h-7 w-7 rounded-md object-contain" />
        <span className="text-lg font-bold" style={{ fontFamily: "Montserrat, sans-serif" }}>
          Mayel'AI
        </span>
      </Link>
      <div className="flex w-full items-center justify-end gap-2 md:gap-4">
        <Link
          to="/chat"
          aria-label="New chat"
          className="rounded-full p-2 transition hover:bg-accent md:hidden"
        >
          <SquarePen className="h-5 w-5" />
        </Link>
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
