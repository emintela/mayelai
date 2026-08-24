import "dotenv/config";
import express from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import chatRouter from "./routes/chat.js";
import aiAgentRouter from "./routes/aiAgent.js";
import langchainSearchRouter from "./routes/langchainSearch.js";
import webSearchRouter from "./routes/webSearch.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(clerkMiddleware());

app.use("/api/chat", chatRouter);
app.use("/api/ai-agent", aiAgentRouter);
app.use("/api/langchain-search", langchainSearchRouter);
app.use("/api/web-search", webSearchRouter);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Mayel AI server listening on http://localhost:${PORT}`);
});
