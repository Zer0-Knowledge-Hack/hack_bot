import { describe, expect, it } from "vitest";
import {
  NL_TEXT_MAX,
  isEligibleNlMessage,
  stripBotMentions,
  stubNlIntent,
} from "../../../src/domain/nl/eligibility";

describe("stripBotMentions", () => {
  it("removes case-insensitive @username tokens", () => {
    expect(stripBotMentions("@HackZK_bot qué hay", "hackZK_bot")).toBe("qué hay");
    expect(stripBotMentions("hola @HACKZK_BOT", "hackZK_bot")).toBe("hola");
  });

  it("collapses leftover whitespace", () => {
    expect(stripBotMentions("  @bot   listá   repos  ", "bot")).toBe("listá repos");
  });
});

describe("isEligibleNlMessage", () => {
  const base = {
    botUsername: "test_bot",
    botId: 42,
    text: "@test_bot ayuda",
    isCommand: false,
    replyFromBotId: null as number | null,
  };

  it("accepts a group @mention", () => {
    const result = isEligibleNlMessage({ ...base, chatType: "supergroup" });
    expect(result).toEqual({ eligible: true, classifiedText: "ayuda" });
  });

  it("accepts a topic reply to the bot without a mention", () => {
    const result = isEligibleNlMessage({
      ...base,
      chatType: "supergroup",
      text: "listá los repos",
      replyFromBotId: 42,
    });
    expect(result).toEqual({ eligible: true, classifiedText: "listá los repos" });
  });

  it("rejects DMs even with a mention", () => {
    expect(isEligibleNlMessage({ ...base, chatType: "private" }).eligible).toBe(false);
  });

  it("rejects plain text without mention or reply-to-bot", () => {
    expect(
      isEligibleNlMessage({
        ...base,
        chatType: "supergroup",
        text: "qué hackathons hay",
      }).eligible,
    ).toBe(false);
  });

  it("rejects bot commands", () => {
    expect(
      isEligibleNlMessage({
        ...base,
        chatType: "supergroup",
        text: "/hackathons",
        isCommand: true,
      }).eligible,
    ).toBe(false);
  });

  it("rejects empty text after stripping the mention", () => {
    expect(
      isEligibleNlMessage({ ...base, chatType: "supergroup", text: "@test_bot   " }).eligible,
    ).toBe(false);
  });

  it("rejects overlong classified text", () => {
    const long = "x".repeat(NL_TEXT_MAX + 1);
    expect(
      isEligibleNlMessage({
        ...base,
        chatType: "supergroup",
        text: `@test_bot ${long}`,
      }).eligible,
    ).toBe(false);
  });

  it("rejects a reply to someone other than the bot", () => {
    expect(
      isEligibleNlMessage({
        ...base,
        chatType: "supergroup",
        text: "sí",
        replyFromBotId: 99,
      }).eligible,
    ).toBe(false);
  });
});

describe("stubNlIntent", () => {
  it("maps Spanish help phrases to help", () => {
    expect(stubNlIntent("ayuda")).toBe("help");
    expect(stubNlIntent("¿qué puedes hacer?")).toBe("help");
    expect(stubNlIntent("como te uso")).toBe("help");
  });

  it("maps everything else to unknown", () => {
    expect(stubNlIntent("listá los hackathons")).toBe("unknown");
    expect(stubNlIntent("participemos en meridian")).toBe("unknown");
  });
});
