import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Code,
  ImageIcon,
  LayoutDashboard,
  MessageSquare,
  Music,
  Settings,
  VideoIcon,
} from "lucide-react";

// Routes to be used as links
const routes = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    href: "/dashboard",
    color: "text-sky-500",
  },
  {
    label: "AI Chat",
    icon: MessageSquare,
    href: "/chat",
    color: "text-violet-500",
  },
  {
    label: "Image Generation",
    icon: ImageIcon,
    href: "/image",
    color: "text-pink-700",
  },
  {
    label: "Video Generation",
    icon: VideoIcon,
    href: "/video",
    color: "text-orange-700",
  },
  {
    label: "Music Generation",
    icon: Music,
    href: "/music",
    color: "text-emerald-700",
  },
  {
    label: "Code Generation",
    icon: Code,
    href: "/code",
    color: "text-green-500",
  },
  {
    label: "Settings",
    icon: Settings,
    href: "/settings",
  },
];

const Sidebar = () => {
  const { pathname } = useLocation();

  return (
    <div className="flex h-full flex-col space-y-4 bg-[#662d91] py-4 text-white">
      <div className="flex-1 px-3 py-2">
        <Link to="/dashboard" className="mb-14 flex items-center gap-3 pl-3">
          <div className="relative h-9 w-9 overflow-hidden rounded-lg ring-1 ring-white/20">
            <img alt="logo" src="/logo1.png" className="absolute inset-0 h-full w-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "Montserrat, sans-serif" }}>
            Mayel'AI
          </h1>
        </Link>
        <div className="space-y-1">
          {routes.map((route) => (
            <Link
              to={route.href}
              key={route.href}
              className={cn(
                "group flex w-full cursor-pointer justify-start rounded-lg border-l-2 border-transparent p-3 text-sm font-medium transition hover:bg-white/10 hover:text-white",
                pathname === route.href
                  ? "border-amber-400 bg-white/15 text-white"
                  : "text-white/60"
              )}
            >
              <div className="flex flex-1 items-center">
                <route.icon className={cn("mr-3 h-5 w-5", route.color)} />
                {route.label}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
