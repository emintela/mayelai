import { NextResponse } from "next/server";
import { GoogleSearch } from "serpapi"; // ✅ Correct import
import "dotenv/config";

// ✅ API Key from .env
const apiKey = process.env.SERPAPI_KEY;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { query } = body;

    if (!query) {
      return new NextResponse("Search query is required", { status: 400 });
    }

    console.log("🔍 Performing Real Web Search for:", query);

    // ✅ Perform a real-time Google search using SerpAPI
    const search = new GoogleSearch(apiKey);
    const searchResults = await new Promise((resolve, reject) => {
      search.json(
        {
          q: query,
          location: "United States",
          hl: "en",
          gl: "us",
          api_key: apiKey, // ✅ Ensure API key is passed
        },
        (data) => {
          resolve(data);
        }
      );
    });

    console.log("✅ Real Web Search Results:", searchResults);

    const firstResult = searchResults?.organic_results?.[0]?.snippet || "No relevant results found.";

    return NextResponse.json({ result: firstResult });
  } catch (error) {
    console.error("[WEB_SEARCH_ERROR]", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
