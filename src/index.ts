import { Hono } from "hono";

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  PII_KEYRING: string;
  BOT_INFO: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ status: "ok" }));

export default app;
