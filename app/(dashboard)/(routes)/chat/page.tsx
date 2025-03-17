"use client";

import { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import Heading from "@/components/heading";
import { MessageSquare } from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { formSchema } from "./constants";
import { zodResolver } from "@hookform/resolvers/zod";
import axios from "axios";

const GOOGLE_SEARCH_SCRIPT_ID = "google-search-script";

const ChatPage = () => {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchButton, setShowSearchButton] = useState(false);
  const [showSearchBox, setShowSearchBox] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { prompt: "" },
  });

  const isLoading = form.formState.isSubmitting;

  // ✅ Ensure Google Search script loads ONCE
  useEffect(() => {
    if (!document.getElementById(GOOGLE_SEARCH_SCRIPT_ID)) {
      const script = document.createElement("script");
      script.id = GOOGLE_SEARCH_SCRIPT_ID;
      script.src = "https://cse.google.com/cse.js?cx=6565e185166e44ae7"; // Replace with your CX ID
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  // ✅ Scroll to the bottom when messages update
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const userMessage = { role: "user", content: values.prompt };
      const newMessages = [...messages, userMessage];

      console.log("🤖 Sending request to AI chat...");
      const response = await axios.post("/api/chat", { messages: newMessages });

      const aiResponse = response.data.message;
      const suggestSearch = response.data.searchSuggestion || false;

      setMessages((current) => [...current, userMessage, { role: "assistant", content: aiResponse }]);
      setSearchQuery(values.prompt);
      setShowSearchButton(suggestSearch);
      setShowSearchBox(false);

      form.reset();
    } catch (error) {
      console.log(error);
    }
  };

  // ✅ Perform Google Search and keep the search box visible
  const performSearch = () => {
    setShowSearchBox(true);

    setTimeout(() => {
      const searchBox = document.querySelector("input.gsc-input");
      if (searchBox) {
        searchBox.value = searchQuery;
        searchBox.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector(".gsc-search-button")?.click();
      }
    }, 1000);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* ✅ Header */}
      <Heading
        title="AI Chat"
        description="Mayel'AI Advanced AI Chat"
        icon={MessageSquare}
        iconColor="text-violet-500"
        bgColor="text-violet-500/10"
      />

      {/* ✅ Chat History Container */}
      <div
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {messages.map((message, index) => (
          <div key={index} className={`p-3 rounded-lg max-w-lg ${message.role === "user" ? "bg-blue-100 self-end" : "bg-gray-200 self-start"}`}>
            <strong>{message.role === "user" ? "👤 You" : "🤖 AI"}:</strong> {message.content}
          </div>
        ))}

        {/* ✅ Keep Google Search Box Visible */}
        {showSearchBox && (
          <div className="mt-6 p-4 border rounded-lg bg-white shadow">
            <h3 className="text-lg font-semibold">🔍 Web Search Results:</h3>
            <div className="gcse-searchresults-only"></div> {/* ✅ Search Results Only */}
          </div>
        )}
      </div>

      {/* ✅ Chat Input Box (Sticky at Bottom) */}
      <div className="sticky bottom-0 left-0 right-0 bg-white p-4 border-t shadow">
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex items-center space-x-2">
          <input
            {...form.register("prompt")}
            placeholder="Ask me anything..."
            className="flex-1 border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
          >
            Generate
          </button>
        </form>

        {/* ✅ "Search the Web" Button */}
        {showSearchButton && (
          <button
            onClick={performSearch}
            className="mt-2 w-full px-4 py-2 text-white bg-red-500 rounded-lg shadow hover:bg-red-600 transition cursor-pointer"
          >
            <Search className="w-4 h-4 inline-block mr-2" />
            Search the Web
          </button>
        )}
      </div>
    </div>
  );
};

export default ChatPage;
