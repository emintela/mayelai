"use client";

import { useState, useEffect, useRef } from "react";
import { Search, Brain, Copy, ThumbsUp, ThumbsDown, RotateCw, Share2, MoreHorizontal } from "lucide-react";
import Heading from "@/components/heading";
import { MessageSquare } from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { formSchema } from "./constants";
import { zodResolver } from "@hookform/resolvers/zod";
import axios from "axios";
import Link from "next/link";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const ChatPage = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchButton, setShowSearchButton] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { prompt: "" },
  });

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const userMessage: ChatMessage = { role: "user", content: values.prompt };
      const newMessages = [...messages, userMessage];

      const response = await axios.post("/api/chat", { messages: newMessages });
      const aiResponse: string = response.data.message;
      const suggestSearch: boolean = response.data.searchSuggestion || false;

      setMessages((prev) => [...prev, userMessage, { role: "assistant", content: aiResponse }]);
      setSearchQuery(values.prompt);
      setShowSearchButton(suggestSearch);

      reset();
    } catch (error) {
      console.error("❌ AI Chat Error:", error);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100 items-center justify-start">
      <Heading
        title="AI Chat"
        description="Mayel'AI Advanced AI Chat with Web Search"
        icon={MessageSquare}
        iconColor="text-violet-500"
        bgColor="text-violet-500/10"
      />

      <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 w-full max-w-5xl">
        {messages.map((message, index) => (
          <div key={index} className={`p-3 rounded-lg max-w-2xl ${message.role === "user" ? "bg-blue-100 self-end" : "bg-gray-200 self-start relative"}`}>
            <strong>{message.role === "user" ? "👤 You" : "🤖 AI"}:</strong>
            <div className="whitespace-pre-wrap">
              {message.content}
            </div>
            {message.role === "assistant" && (
              <div className="flex justify-between items-center mt-2">
                <div className="flex space-x-2">
                  <button className="p-1 rounded hover:bg-gray-300">
                    <ThumbsUp className="w-4 h-4" />
                  </button>
                  <button className="p-1 rounded hover:bg-gray-300">
                    <ThumbsDown className="w-4 h-4" />
                  </button>
                  <button className="p-1 rounded hover:bg-gray-300">
                    <RotateCw className="w-4 h-4" />
                  </button>
                  <button className="p-1 rounded hover:bg-gray-300">
                    <Share2 className="w-4 h-4" />
                  </button>
                  <button className="p-1 rounded hover:bg-gray-300">
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </div>
                <button
                  className="p-1 bg-gray-300 rounded hover:bg-gray-400"
                  onClick={() => handleCopy(message.content)}
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="w-full max-w-5xl bg-white p-4 border-t shadow sticky bottom-0">
        <form onSubmit={handleSubmit(onSubmit)} className="flex items-center space-x-2">
          <input
            {...register("prompt")}
            placeholder="Ask me anything..."
            className="flex-1 border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isSubmitting}
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
          >
            Generate
          </button>
        </form>

        {showSearchButton && (
          <div className="flex justify-between mt-2">
            <Link href={`/websearch?searchQuery=${encodeURIComponent(searchQuery)}`} className="w-1/2 mr-1">
              <button className="w-full px-4 py-2 text-white bg-red-500 rounded-lg shadow hover:bg-red-600 transition cursor-pointer">
                <Search className="w-4 h-4 inline-block mr-2" />
                Web Search
              </button>
            </Link>
            <button
              onClick={() => handleSubmit(onSubmit)({ prompt: searchQuery })}
              className="w-1/2 ml-1 px-4 py-2 text-white bg-green-500 rounded-lg shadow hover:bg-green-600 transition cursor-pointer"
            >
              <Brain className="w-4 h-4 inline-block mr-2" />
              AI Search
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatPage;