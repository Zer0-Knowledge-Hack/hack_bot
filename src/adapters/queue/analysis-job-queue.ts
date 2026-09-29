import { QueueSendFailedError } from "../../domain/errors";
import type { AnalysisJobMessage } from "../../domain/entities";
import type { AnalysisJobQueue } from "../../domain/ports";

// Injected `send`: a minimal structural subset of the real Queue binding's
// `send(message)` (design.md "Adapters": "Injected ... `send`"). The
// concrete `env.HACKATHON_QUEUE` binding is wired in PR10.
export interface QueueSender {
  send(message: AnalysisJobMessage): Promise<void>;
}

// design.md "Error Taxonomy": any send failure becomes
// `QueueSendFailedError` with a fixed message — the underlying error text
// (which can echo the payload, including the fetch URL) is never carried
// over.
export function createQueueAnalysisJobQueue(queue: QueueSender): AnalysisJobQueue {
  return {
    async enqueue(message: AnalysisJobMessage): Promise<void> {
      try {
        await queue.send(message);
      } catch {
        throw new QueueSendFailedError("Queue.send failed");
      }
    },
  };
}
