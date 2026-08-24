import { Router } from "express";
import { getAuth } from "@clerk/express";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      return res.status(401).send("Unauthorized");
    }

    const { messages } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).send("OpenAI API key missing");
    }

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).send("Messages array is required");
    }

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages,
    });

    let reply = response.choices[0]?.message?.content || "";

    const noAnswerPhrases = [
      "I'm sorry",
      "I couldn't find an answer",
      "I don't know",
      "I am not sure",
      "I apologize",
      "I'm not sure",
      "I'm not familiar",
      "I couldn't find",
      "I am not able",
    ];
    const suggestSearch = noAnswerPhrases.some((phrase) => reply.includes(phrase));

    console.log("🚀 AI Response:", reply);
    console.log("🔍 Suggest Search?", suggestSearch);

    res.json({
      message: reply,
      searchSuggestion: suggestSearch,
    });
  } catch (error) {
    console.error("[CHAT_API_ERROR]", error);
    res.status(500).send("Internal Server Error");
  }
});

export default router;
