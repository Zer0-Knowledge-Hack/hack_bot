import type { Api } from "grammy";

export interface VoiceDownloader {
  download(fileId: string): Promise<ArrayBuffer>;
}

export function createTelegramVoiceDownloader(
  api: Api,
  botToken: string,
): VoiceDownloader {
  return {
    async download(fileId: string): Promise<ArrayBuffer> {
      const file = await api.getFile(fileId);
      if (!file.file_path) {
        throw new Error("Telegram did not return a file_path for voice note");
      }
      const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download voice file from Telegram: ${response.status}`);
      }
      return await response.arrayBuffer();
    },
  };
}
