import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Heading from "@/components/heading";
import { Search } from "lucide-react";

const WebSearchPage = () => {
  const [searchParams] = useSearchParams();
  const searchQuery = searchParams.get("searchQuery");
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://cse.google.com/cse.js?cx=6565e185166e44ae7";
    script.async = true;
    script.onload = () => setIsScriptLoaded(true);
    document.body.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  useEffect(() => {
    if (isScriptLoaded && window.google && window.google.search && searchQuery) {
      const searchBox = document.querySelector("input.gsc-input");
      const searchButton = document.querySelector(".gsc-search-button");

      if (searchBox && searchButton) {
        searchBox.value = searchQuery;
        searchBox.dispatchEvent(new Event("input", { bubbles: true }));
        searchButton.click();
      }
    }
  }, [searchQuery, isScriptLoaded]);

  return (
    <div className="flex min-h-full flex-col bg-background">
      <Heading
        title="🌐 Web Search"
        description="Real-time results from across the web"
        icon={Search}
        iconColor="text-amber-500"
        bgColor="bg-amber-500/10"
      />
      <div className="mx-auto w-full max-w-4xl flex-1 px-4 pb-8">
        {!isScriptLoaded && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" />
            <span className="ml-1">Loading search…</span>
          </div>
        )}
        <div className="gcse-search"></div>
      </div>
    </div>
  );
};

export default WebSearchPage;
