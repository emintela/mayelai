import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import OpenAI from "openai";

// ✅ Ensure API key is available
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // ✅ Parse request body
    const body = await req.json();
    const { messages } = body;

    if (!process.env.OPENAI_API_KEY) {
      return new NextResponse("OpenAI API key missing", { status: 500 });
    }

    if (!messages || !Array.isArray(messages)) {
      return new NextResponse("Messages array is required", { status: 400 });
    }

    // ✅ Call OpenAI API
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages,
    });

    let reply = response.choices[0]?.message?.content || "";

    // ✅ Detect if AI response is unhelpful
    const noAnswerPhrases = [
      "I'm sorry",
      "I couldn't find an answer",
      "I don't know",
      "I am not sure",
    ];
    const suggestSearch = noAnswerPhrases.some((phrase) => reply.includes(phrase));

    console.log("🚀 AI Response:", reply);
    console.log("🔍 Suggest Search?", suggestSearch); // ✅ Add log for debugging

    return NextResponse.json({
      message: reply,
      searchSuggestion: suggestSearch, // ✅ This should be true when AI lacks an answer
    });

  } catch (error) {
    console.error("[CHAT_API_ERROR]", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
