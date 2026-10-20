import type { FeedbackNote } from "../../domain/entities";
import type { FeedbackSynthesizer } from "../../domain/usecases/synthesize-feedback";

export type WorkersAiRun = (
  model: string,
  inputs: Record<string, unknown>,
  options?: { signal?: AbortSignal },
) => Promise<unknown>;

export interface WorkersAiFeedbackSynthesizerOptions {
  run: WorkersAiRun;
  modelId: string;
}

const SYSTEM_PROMPT = `Eres un asistente técnico de ingeniería de software para un equipo de desarrolladores.
Tu tarea es sintetizar una lista de observaciones de feedback y reportes de errores recibidos en Telegram.

Reglas:
1. Agrupa observaciones duplicadas, similares o relacionadas por tema/componente.
2. Destaca severidad o impacto evidente.
3. Formula sugerencias accionables y redactadas de forma clara para redactar issues o tareas técnicas en GitHub.
4. Escribe en español neutro, conciso y profesional, utilizando formato Markdown limpio con viñetas.
5. NO inventes información que no esté en las notas.`;

function extractText(raw: unknown): string {
  if (raw !== null && typeof raw === "object" && "choices" in raw) {
    const { choices } = raw as { choices: unknown };
    const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
    const message =
      first !== null && typeof first === "object"
        ? (first as { message?: unknown }).message
        : undefined;
    const content =
      message !== null && typeof message === "object"
        ? (message as { content?: unknown }).content
        : undefined;
    if (typeof content === "string") return content.trim();
  }
  if (raw !== null && typeof raw === "object" && "response" in raw) {
    const { response } = raw as { response: unknown };
    if (typeof response === "string") return response.trim();
  }
  return "";
}

export function createWorkersAiFeedbackSynthesizer(
  options: WorkersAiFeedbackSynthesizerOptions,
): FeedbackSynthesizer {
  const { run, modelId } = options;

  return {
    async summarize(notes: FeedbackNote[], signal?: AbortSignal): Promise<string> {
      if (notes.length === 0) return "";

      const notesBlock = notes
        .map((n, idx) => {
          const dateStr = new Date(n.createdAt).toISOString().slice(0, 10);
          const repo = n.repoHint ? ` [repo: ${n.repoHint}]` : "";
          const source = n.sourceType === "voice" ? " [audio]" : "";
          return `${idx + 1}. [${dateStr}]${repo}${source}: ${n.rawText}`;
        })
        .join("\n");

      const raw = await run(
        modelId,
        {
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `Por favor sintetiza las siguientes observaciones:\n\n${notesBlock}`,
            },
          ],
        },
        signal ? { signal } : undefined,
      );

      return extractText(raw);
    },
  };
}
