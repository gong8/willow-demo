import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createLogger } from "./logger";
import { chatRoutes } from "./routes/chat";
import { attachmentRoutes } from "./routes/chat-attachments";
import { graphRoutes } from "./routes/graph";
import { resourceRoutes } from "./routes/resources";

const log = createLogger("server");

const app = new Hono();

app.use("*", cors());
app.route("/chat", chatRoutes);
app.route("/chat/attachments", attachmentRoutes);
app.route("/graph", graphRoutes);
app.route("/resources", resourceRoutes);
app.get("/", (c) => c.json({ name: "willow-api", version: "0.1.0" }));

const port = Number(process.env.PORT) || 8787;

serve({ fetch: app.fetch, port }, () => {
	log.info("Willow API running", { port });
});

for (const event of ["unhandledRejection", "uncaughtException"] as const) {
	process.on(event, (err: unknown) => {
		log.error(event, {
			error: String(err instanceof Error ? err.message : err),
		});
	});
}
