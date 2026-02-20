import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createLogger } from "./logger.js";
import { attachmentRoutes } from "./routes/chat-attachments.js";
import { chatRoutes } from "./routes/chat.js";
import { graphRoutes } from "./routes/graph.js";

const log = createLogger("server");

const app = new Hono();

app.use("*", cors());
app.route("/chat", chatRoutes);
app.route("/chat/attachments", attachmentRoutes);
app.route("/graph", graphRoutes);
app.get("/", (c) => c.json({ name: "willow-api", version: "0.1.0" }));

const port = Number(process.env.PORT) || 8787;

serve({ fetch: app.fetch, port }, () => {
	log.info("Willow API running", { port });
});

process.on("unhandledRejection", (reason) => {
	log.error("Unhandled rejection", { reason: String(reason) });
});

process.on("uncaughtException", (err) => {
	log.error("Uncaught exception", { error: err.message });
});
