"use client";

import { Card } from "@/components/ui/card";
import { ArrowRight, Code, ImageIcon, ImagesIcon, MessageSquare, Music, VideoIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

const tools = [
  {
    label: "Conversation",
    icon: MessageSquare,
    color: "text-violet-500",
    bgColor: "bg-violet-500/10",
    href:"/chat"
  },
  {
    label: "Music Generation",
    icon: Music,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    href:"/music"
  },
  {
    label: "Image Generation",
    icon: ImagesIcon,
    color: "text-pink-700",
    bgColor: "bg-pink-700/10",
    href:"/image"
  },
  {
    label: "Video Generation",
    icon: VideoIcon,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    href:"/video"
  },
  {
    label: "Code Generation",
    icon: Code,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    href:"/music"
  },
];

const DashboardPage = () => {
  const router = useRouter()

  return (
    <div>
      {/* Header Section */}
      <div className="mb-8 space-y-4">
        <h2 className="text-2xl md:text-4xl font-bold text-center">
          Explore the Power of AI
        </h2>
        <p className="text-muted-foreground font-light text-sm md:text-lg text-center">
          Chat with Mayel'AI and feel the power of AI
        </p>
      </div>

      {/* Tools Section */}
      <div className="px-4 md:px-20 lg:px-32 space-y-4">
        {tools.map((tool, index) => (
          <Card
            onClick = {()=> router.push(tool.href)}
            key={index}
            className="p-4 border-black/5 flex  justify-between 
            hover:shadow-md transition cursor-pointer w-full"
          >
            {/* ✅ Left side: Flex container with icon and label */}
            <div className="flex items-center gap-x-4">
              <div className={cn("p-2 w-fit rounded-md", tool.bgColor)}>
                <tool.icon className={cn("w-8 h-8", tool.color)} />
              </div>
              <div className="font-semibold">{tool.label}</div>
            </div>

            {/* ✅ Right side: Arrow stays on the far right */}
            <div className="ml-auto">
              <ArrowRight className="w-5 h-5 text-gray-500" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default DashboardPage;
