import { Bot } from "grammy";
import { describe, expect, it } from "vitest";

describe("grammY Bot API stub under vitest-pool-workers", () => {
  it("intercepts an API call with a transformer instead of hitting the network", async () => {
    const bot = new Bot("000000000:TEST-TOKEN-NOT-REAL", {
      botInfo: {
        id: 1,
        is_bot: true,
        first_name: "TestBot",
        username: "test_bot",
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
        has_topics_enabled: false,
        allows_users_to_create_topics: false,
        can_manage_bots: false,
        supports_join_request_queries: false,
      },
    });

    let interceptedMethod: string | undefined;
    bot.api.config.use((_prev, method, payload, signal) => {
      interceptedMethod = method;
      return Promise.resolve({
        ok: true,
        result: {
          message_id: 42,
          date: 0,
          chat: { id: 123, type: "private" },
        },
      } as never);
    });

    const result = await bot.api.sendMessage(123, "hello from a stub");

    expect(interceptedMethod).toBe("sendMessage");
    expect(result.message_id).toBe(42);
  });
});
