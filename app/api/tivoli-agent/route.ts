import { NextResponse } from "next/server";
import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor } from "langchain/agents";
import { LangGraph } from "langgraph";
import "dotenv/config"; // Load environment variables

// ✅ Ensure your OpenAI key is set in .env.local
const openaiApiKey = process.env.OPENAI_API_KEY;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { query } = body;

    if (!query) {
      return new NextResponse("Search query is required", { status: 400 });
    }
    if (!openaiApiKey) {
      return new NextResponse("OPENAI_API_KEY is missing", { status: 500 });
    }

    // ✅ Initialize OpenAI Chat Model
    const llm = new ChatOpenAI({
      temperature: 0,
      modelName: "gpt-4-turbo",
      openAIApiKey: openaiApiKey,
    });

    // ✅ Create a LangGraph agent
    const graph = new LangGraph({
      nodes: {
        search: async (input: { query: string }) => {
          return await llm.invoke(input.query);
        },
      },
    });

    const agentExecutor = new AgentExecutor({
      agent: graph,
    });

    // ✅ Execute the AI-powered search
    const result = await agentExecutor.invoke({ query });

    console.log("🔍 Tivoli AI Web Search Result:", result);

    return NextResponse.json({ result });
  } catch (error) {
    console.error("[TIVOLI_AI_SEARCH_ERROR]", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
