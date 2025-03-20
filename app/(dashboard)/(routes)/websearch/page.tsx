// app/websearch/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from 'next/navigation'; // Import useSearchParams

const WebSearch = () => {
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get('searchQuery');
  const [isScriptLoaded, setIsScriptLoaded] = useState(false); // Add state

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://cse.google.com/cse.js?cx=6565e185166e44ae7";
    script.async = true;
    script.onload = () => setIsScriptLoaded(true); // Set state when script loads
    document.body.appendChild(script);

    return () => {
      const existingScript = document.getElementById("google-search-script");
      if (existingScript) {
        existingScript.remove();
      }
    };
  }, []);

  useEffect(() => {
    if (isScriptLoaded && window.google && window.google.search && searchQuery) {
      const searchBox = document.querySelector("input.gsc-input") as HTMLInputElement | null;
      const searchButton = document.querySelector(".gsc-search-button") as HTMLButtonElement | null;

      if (searchBox && searchButton) {
        searchBox.value = searchQuery;
        searchBox.dispatchEvent(new Event("input", { bubbles: true }));
        searchButton.click();
      }
    }
  }, [searchQuery, isScriptLoaded]); // Add isScriptLoaded to dependencies

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <div className="flex-1 p-4">
        <div className="gcse-search"></div>
      </div>
    </div>
  );
};

export default WebSearch;