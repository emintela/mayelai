import { Router } from "express";
import { getJson } from "serpapi";

const apiKey = process.env.SERPAPI_KEY;

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).send("Search query is required");
    }

    console.log("🔍 Performing Real Web Search for:", query);

    const searchResults = await getJson({
      q: query,
      location: "United States",
      hl: "en",
      gl: "us",
      api_key: apiKey,
    });

    console.log("✅ Real Web Search Results:", searchResults);

    const firstResult = searchResults?.organic_results?.[0]?.snippet || "No relevant results found.";

    res.json({ result: firstResult });
  } catch (error) {
    console.error("[WEB_SEARCH_ERROR]", error);
    res.status(500).send("Internal Server Error");
  }
});

export default router;
