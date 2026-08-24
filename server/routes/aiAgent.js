import { Router } from "express";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { query } = req.body;
    console.log("🤖 AI Agent Processing:", query);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-search-preview",
      web_search_options: {
        search_context_size: "medium",
      },
      messages: [{ role: "user", content: query }],
    });

    const aiResponse = response.choices[0].message.content;
    console.log("✅ AI Agent Result:", aiResponse);

    res.json({ message: aiResponse });
  } catch (error) {
    console.error("❌ AI Agent Error:", error);
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;
