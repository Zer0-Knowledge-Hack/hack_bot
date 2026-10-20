import { describe, expect, it } from "vitest";
import { createWorkersAiFeedbackSynthesizer } from "../../../src/adapters/llm/workers-ai-feedback-synthesizer";
import type { FeedbackNote } from "../../../src/domain/entities";
import { asMembershipId, asTeamId } from "../../../src/domain/ids";

describe("createWorkersAiFeedbackSynthesizer", () => {
  it("returns empty string when notes array is empty", async () => {
    let called = false;
    const synthesizer = createWorkersAiFeedbackSynthesizer({
      modelId: "@cf/meta/llama-3-8b-instruct",
      run: async () => {
        called = true;
        return { response: "Summary" };
      },
    });

    const result = await synthesizer.summarize([]);
    expect(result).toBe("");
    expect(called).toBe(false);
  });

  it("calls run with formatted notes and returns response text", async () => {
    let capturedModel = "";
    let capturedMessages: unknown = null;

    const synthesizer = createWorkersAiFeedbackSynthesizer({
      modelId: "@cf/meta/llama-3-8b-instruct",
      run: async (model, inputs) => {
        capturedModel = model;
        capturedMessages = inputs.messages;
        return { response: "Resumen estructurado de observaciones." };
      },
    });

    const notes: FeedbackNote[] = [
      {
        id: "note-1",
        teamId: asTeamId("team-1"),
        authorMembershipId: asMembershipId("mem-1"),
        repoHint: "org/puls3",
        rawText: "El login da error 500",
        sourceType: "text",
        status: "inbox",
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
      {
        id: "note-2",
        teamId: asTeamId("team-1"),
        authorMembershipId: asMembershipId("mem-2"),
        repoHint: null,
        rawText: "El audio se escucha cortado",
        sourceType: "voice",
        status: "inbox",
        createdAt: 1700000001000,
        updatedAt: 1700000001000,
      },
    ];

    const result = await synthesizer.summarize(notes);
    expect(result).toBe("Resumen estructurado de observaciones.");
    expect(capturedModel).toBe("@cf/meta/llama-3-8b-instruct");
    const msgs = capturedMessages as Array<{ role: string; content: string }>;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe("system");
    expect(msgs[1]?.content).toContain("El login da error 500");
    expect(msgs[1]?.content).toContain("[audio]");
  });

  it("handles choices[0].message.content shape", async () => {
    const synthesizer = createWorkersAiFeedbackSynthesizer({
      modelId: "@cf/meta/llama-3-8b-instruct",
      run: async () => ({
        choices: [{ message: { content: "Resumen desde choices" } }],
      }),
    });

    const notes: FeedbackNote[] = [
      {
        id: "note-1",
        teamId: asTeamId("team-1"),
        authorMembershipId: asMembershipId("mem-1"),
        repoHint: null,
        rawText: "Test",
        sourceType: "text",
        status: "inbox",
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
    ];

    const result = await synthesizer.summarize(notes);
    expect(result).toBe("Resumen desde choices");
  });
});
