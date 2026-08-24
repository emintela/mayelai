import { Card } from "@/components/ui/card";
import { ArrowRight, Code, ImagesIcon, MessageSquare, Music, VideoIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

const tools = [
  {
    label: "AI Chat",
    emoji: "💬",
    icon: MessageSquare,
    color: "text-primary",
    bgColor: "bg-primary/10",
    href: "/chat"
  },
  {
    label: "Music Generation",
    emoji: "🎵",
    icon: Music,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    href: "/music"
  },
  {
    label: "Image Generation",
    emoji: "🖼️",
    icon: ImagesIcon,
    color: "text-pink-700",
    bgColor: "bg-pink-700/10",
    href: "/image"
  },
  {
    label: "Video Generation",
    emoji: "🎬",
    icon: VideoIcon,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    href: "/video"
  },
  {
    label: "Code Generation",
    emoji: "💻",
    icon: Code,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    href: "/music"
  },
];

const DashboardPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-full bg-gradient-to-b from-background to-muted/30 pb-16">
      {/* Header Section */}
      <div className="space-y-4 px-4 pb-8 pt-10 text-center">
        <h2 className="text-2xl font-bold md:text-4xl">
          ✨ Explore the Power of AI
        </h2>
        <p className="text-sm font-light text-muted-foreground md:text-lg">
          Chat with Mayel'AI and feel the power of AI
        </p>
      </div>

      {/* Tools Section */}
      <div className="mx-auto max-w-3xl space-y-3 px-4 md:px-8">
        {tools.map((tool, index) => (
          <Card
            onClick={() => navigate(tool.href)}
            key={index}
            className="group flex w-full cursor-pointer items-center justify-between border-border p-4 transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <div className="flex items-center gap-x-4">
              <div className={cn("flex h-12 w-12 items-center justify-center rounded-xl text-xl", tool.bgColor)}>
                <span aria-hidden>{tool.emoji}</span>
              </div>
              <div className="font-semibold">{tool.label}</div>
            </div>

            <div className="ml-auto">
              <ArrowRight className="h-5 w-5 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-foreground" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default DashboardPage;
