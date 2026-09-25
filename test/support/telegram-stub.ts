import { vi } from "vitest";

// READ-002 (PR4 correction): shared outbound-Telegram-HTTP stub, extracted
// from the copy this file replaces in test/http/webhook-e2e.test.ts and the
// near-duplicates in test/adapters/telegram/alert-sender.test.ts and
// test/http/github-webhook-delivery-e2e.test.ts.
//
// Seam note (from the original webhook-e2e.test.ts doc comment): grammY's
// `Bot`/`Api`/`ApiClient` resolves the bare `fetch` identifier at
// construction time (see node_modules/grammy/out/web.mjs), and
// @cloudflare/vitest-pool-workers runs the `main` worker in the SAME
// isolate as the test file, so stubbing `globalThis.fetch` before the
// request is enough to intercept grammY's outbound calls — no production
// seam is needed.
export type TelegramCall = { method: string; body: unknown };

// `handler` may return either:
// - a full Telegram API response shape (`{ ok: boolean; ... }`, e.g. an
//   `{ ok: false, error_code, description }` failure) — sent as-is, or
// - a partial `result` payload (or `undefined`) — wrapped in
//   `{ ok: true, result }`, with a default `getChatMember`/`sendMessage`
//   shape when no handler/result is given.
export function stubTelegramApi(
  handler?: (method: string, body: unknown) => unknown,
): TelegramCall[] {
  const calls: TelegramCall[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = url.split("/").pop() ?? "";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, body });
      const result = handler?.(method, body);
      if (result && typeof result === "object" && "ok" in result) {
        return new Response(JSON.stringify(result), {
          headers: { "content-type": "application/json" },
        });
      }
      const defaultResult =
        result ??
        (method === "getChatMember"
          ? { status: "administrator", user: { id: 1, is_bot: false, first_name: "Admin" } }
          : { message_id: calls.length, date: 0, chat: { id: 1, type: "supergroup" } });
      return new Response(JSON.stringify({ ok: true, result: defaultResult }), {
        headers: { "content-type": "application/json" },
      });
    },
  );
  return calls;
}
