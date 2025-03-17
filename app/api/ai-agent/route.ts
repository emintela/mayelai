import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, 
});

export async function POST(req: Request) {
  try {
    const { query } = await req.json();
    console.log("🤖 AI Agent Processing:", query);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-search-preview", // ✅ Enables web search
      web_search_options: {
        search_context_size: "medium", // Adjust for speed vs. quality
      },
      messages: [
        { role: "user", content: query },
      ],
    });

    const aiResponse = response.choices[0].message.content;
    console.log("✅ AI Agent Result:", aiResponse);

    return NextResponse.json({ message: aiResponse });
  } catch (error) {
    console.error("❌ AI Agent Error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
