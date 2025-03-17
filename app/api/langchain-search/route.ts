import { NextResponse } from "next/server";
import { AgentExecutor, createOpenAIToolsAgent } from "langchain/agents";
import { pull } from "langchain/hub";
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import "dotenv/config"; // Load environment variables

// ✅ Ensure your OpenAI key is set in .env.local
const openaiApiKey = process.env.OPENAI_API_KEY;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { query, chat_history = [] } = body;

    if (!query) {
      return new NextResponse("Search query is required", { status: 400 });
    }
    if (!openaiApiKey) {
      return new NextResponse("OPENAI_API_KEY is missing", { status: 500 });
    }

    // ✅ Load an OpenAI-compatible search agent prompt
    const prompt = await pull("hwchase17/openai-tools-agent");

    // ✅ Initialize OpenAI Chat Model
    const llm = new ChatOpenAI({
      temperature: 0,
      modelName: "gpt-3.5-turbo-1106",
      openAIApiKey: openaiApiKey,
    });

    // ✅ Define tools for the agent (Web Search tool)
    const tools = []; // We can define custom web search tools here if needed.

    // ✅ Create OpenAI Tools Agent
    const agent = await createOpenAIToolsAgent({
      llm,
      tools,
      prompt,
    });

    const agentExecutor = new AgentExecutor({
      agent,
      tools,
    });

    // ✅ Execute the search with or without chat history
    const result = await agentExecutor.invoke({
      input: query,
      chat_history: chat_history.map((msg: any) =>
        msg.role === "user" ? new HumanMessage(msg.content) : new AIMessage(msg.content)
      ),
    });

    console.log("🔍 LangChain OpenAI Search Result:", result);

    return NextResponse.json({ result });
  } catch (error) {
    console.error("[LANGCHAIN_OPENAI_SEARCH_ERROR]", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
