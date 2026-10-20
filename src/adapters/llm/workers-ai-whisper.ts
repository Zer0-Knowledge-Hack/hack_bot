import type { SpeechToText } from "../../domain/ports";

export type WorkersAiRun = (
  model: string,
  inputs: Record<string, unknown>,
  options?: { signal?: AbortSignal },
) => Promise<unknown>;

export const DEFAULT_WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";

export interface WorkersAiWhisperOptions {
  run: WorkersAiRun;
  modelId?: string;
}

export function createWorkersAiWhisper(options: WorkersAiWhisperOptions): SpeechToText {
  const modelId = options.modelId?.trim() || DEFAULT_WHISPER_MODEL;

  return {
    async transcribe(audioBuffer: ArrayBuffer, signal?: AbortSignal): Promise<string> {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const audioArray = Array.from(new Uint8Array(audioBuffer));

      const result = await options.run(
        modelId,
        {
          audio: audioArray,
        },
        signal ? { signal } : undefined,
      );

      if (typeof result === "object" && result !== null && "text" in result) {
        const text = (result as { text: unknown }).text;
        if (typeof text === "string") {
          return text.trim();
        }
      }

      return "";
    },
  };
}
