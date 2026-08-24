import { Router } from "express";
import { AgentExecutor, createOpenAIToolsAgent } from "langchain/agents";
import { pull } from "langchain/hub";
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

const openaiApiKey = process.env.OPENAI_API_KEY;

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { query, chat_history = [] } = req.body;

    if (!query) {
      return res.status(400).send("Search query is required");
    }
    if (!openaiApiKey) {
      return res.status(500).send("OPENAI_API_KEY is missing");
    }

    const prompt = await pull("hwchase17/openai-tools-agent");

    const llm = new ChatOpenAI({
      temperature: 0,
      modelName: "gpt-3.5-turbo-1106",
      openAIApiKey: openaiApiKey,
    });

    const tools = [];

    const agent = await createOpenAIToolsAgent({
      llm,
      tools,
      prompt,
    });

    const agentExecutor = new AgentExecutor({
      agent,
      tools,
    });

    const result = await agentExecutor.invoke({
      input: query,
      chat_history: chat_history.map((msg) =>
        msg.role === "user" ? new HumanMessage(msg.content) : new AIMessage(msg.content)
      ),
    });

    console.log("🔍 LangChain OpenAI Search Result:", result);

    res.json({ result });
  } catch (error) {
    console.error("[LANGCHAIN_OPENAI_SEARCH_ERROR]", error);
    res.status(500).send("Internal Server Error");
  }
});

export default router;
