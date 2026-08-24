import { useState, useEffect, useRef } from "react";
import {
  Search,
  Brain,
  Copy,
  ThumbsUp,
  ThumbsDown,
  RotateCw,
  Share2,
  Send,
  Loader2,
} from "lucide-react";
import Heading from "@/components/heading";
import { MessageSquare } from "lucide-react";
import { useForm } from "react-hook-form";
import { formSchema } from "./constants";
import { zodResolver } from "@hookform/resolvers/zod";
import axios from "axios";
import { Link } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { cn } from "@/lib/utils";

const Avatar = ({ role }) => (
  <div
    className={cn(
      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg shadow-sm select-none",
      role === "user"
        ? "bg-primary text-primary-foreground"
        : "bg-gradient-to-br from-primary to-fuchsia-500 text-white"
    )}
  >
    {role === "user" ? "🧑" : "🤖"}
  </div>
);

const TypingIndicator = () => (
  <div className="flex items-start gap-3 animate-in fade-in-0 slide-in-from-bottom-1">
    <Avatar role="assistant" />
    <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-border bg-muted px-4 py-3.5 shadow-sm">
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" />
    </div>
  </div>
);

const ChatPage = () => {
  const [messages, setMessages] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchButton, setShowSearchButton] = useState(false);
  const chatContainerRef = useRef(null);
  const { getToken } = useAuth();

  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { prompt: "" },
  });

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, isSubmitting]);

  const onSubmit = async (values) => {
    try {
      const userMessage = { role: "user", content: values.prompt };
      const newMessages = [...messages, userMessage];
      setMessages((prev) => [...prev, userMessage]);
      reset();

      const token = await getToken();
      const response = await axios.post(
        "/api/chat",
        { messages: newMessages },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const aiResponse = response.data.message;
      const suggestSearch = response.data.searchSuggestion || false;

      setMessages((prev) => [...prev, { role: "assistant", content: aiResponse }]);
      setSearchQuery(values.prompt);
      setShowSearchButton(suggestSearch);
    } catch (error) {
      console.error("❌ AI Chat Error:", error);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "⚠️ Something went wrong. Please try again." },
      ]);
    }
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      <Heading
        title="💬 AI Chat"
        description="Mayel'AI — Advanced AI Chat with Web Search"
        icon={MessageSquare}
        iconColor="text-violet-500"
        bgColor="bg-violet-500/10"
      />

      <div
        ref={chatContainerRef}
        className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 overflow-y-auto px-4 py-6"
      >
        {messages.length === 0 && !isSubmitting && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-center">
            <div className="text-5xl">👋</div>
            <h3 className="text-xl font-semibold">Hey, I'm Mayel'AI</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Ask me anything — quick questions or deep dives. I'll offer to search the web
              if I'm not sure. 🔎
            </p>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={cn(
              "flex items-start gap-3 animate-in fade-in-0 slide-in-from-bottom-1",
              message.role === "user" && "flex-row-reverse"
            )}
          >
            <Avatar role={message.role} />
            <div
              className={cn(
                "group relative max-w-[75%] rounded-2xl px-4 py-3 shadow-sm",
                message.role === "user"
                  ? "rounded-br-sm bg-primary text-primary-foreground"
                  : "rounded-bl-sm border border-border bg-muted text-foreground"
              )}
            >
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>

              {message.role === "assistant" && (
                <div className="mt-2 flex items-center justify-between opacity-0 transition-opacity group-hover:opacity-100">
                  <div className="flex space-x-1">
                    <button className="rounded p-1 hover:bg-background/60">
                      <ThumbsUp className="h-3.5 w-3.5" />
                    </button>
                    <button className="rounded p-1 hover:bg-background/60">
                      <ThumbsDown className="h-3.5 w-3.5" />
                    </button>
                    <button className="rounded p-1 hover:bg-background/60">
                      <RotateCw className="h-3.5 w-3.5" />
                    </button>
                    <button className="rounded p-1 hover:bg-background/60">
                      <Share2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button
                    className="rounded p-1 hover:bg-background/60"
                    onClick={() => handleCopy(message.content)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {isSubmitting && <TypingIndicator />}
      </div>

      <div className="sticky bottom-0 w-full border-t border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto w-full max-w-6xl p-4">
          <form onSubmit={handleSubmit(onSubmit)} className="relative flex items-center">
            <input
              {...register("prompt")}
              placeholder="Message Mayel'AI..."
              autoComplete="off"
              className="w-full rounded-full border border-input bg-card py-3 pl-5 pr-14 text-sm shadow-sm outline-none transition focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
              disabled={isSubmitting}
            />
            <button
              type="submit"
              disabled={isSubmitting}
              aria-label="Send message"
              className="absolute right-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </form>

          {showSearchButton && (
            <div className="mt-3 flex gap-2 animate-in fade-in-0 slide-in-from-bottom-1">
              <Link
                to={`/websearch?searchQuery=${encodeURIComponent(searchQuery)}`}
                className="flex-1"
              >
                <button className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-amber-600">
                  <Search className="h-4 w-4" />
                  Web Search 🌐
                </button>
              </Link>
              <button
                onClick={() => handleSubmit(onSubmit)({ prompt: searchQuery })}
                className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition hover:opacity-90"
              >
                <Brain className="h-4 w-4" />
                AI Search ✨
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatPage;
