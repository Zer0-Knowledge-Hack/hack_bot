import { describe, expect, it, vi } from "vitest";
import {
  createWorkersAiWhisper,
  DEFAULT_WHISPER_MODEL,
} from "../../../src/adapters/llm/workers-ai-whisper";

describe("createWorkersAiWhisper", () => {
  it("transcribes audio buffer by calling run with audio array", async () => {
    const run = vi.fn().mockResolvedValue({ text: "  El botón de login no responde  " });
    const whisper = createWorkersAiWhisper({ run });

    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const text = await whisper.transcribe(buffer);

    expect(text).toBe("El botón de login no responde");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(
      DEFAULT_WHISPER_MODEL,
      { audio: [1, 2, 3, 4] },
      undefined,
    );
  });

  it("handles custom model id and abort signals", async () => {
    const run = vi.fn();
    const whisper = createWorkersAiWhisper({
      run,
      modelId: "@cf/openai/whisper",
    });

    const controller = new AbortController();
    controller.abort();

    await expect(
      whisper.transcribe(new Uint8Array([5, 6]).buffer, controller.signal),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it("returns empty string if result does not contain text", async () => {
    const run = vi.fn().mockResolvedValue({});
    const whisper = createWorkersAiWhisper({ run });

    const text = await whisper.transcribe(new Uint8Array([1]).buffer);
    expect(text).toBe("");
  });
});
