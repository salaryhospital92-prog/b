import { readRuntimeVariable } from "./supabase-server";

type TelegramReplyMarkup = Record<string, unknown>;

function telegramToken() {
  const token = readRuntimeVariable("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram bot is not configured");
  return token;
}

async function telegramRequest<T>(method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${telegramToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json() as { ok: boolean; result?: T; description?: string };
  if (!response.ok || !result.ok) throw new Error(result.description || "Telegram request failed");
  return result.result as T;
}

export function telegramMainKeyboard(): TelegramReplyMarkup {
  return {
    keyboard: [
      [{ text: "تسجيل حضور" }, { text: "تسجيل انصراف" }],
      [{ text: "مهامي" }, { text: "حالتي" }],
      [{ text: "من موجود الآن" }, { text: "مساعدة" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export async function sendTelegramMessage(chatId: number, text: string, replyMarkup?: TelegramReplyMarkup) {
  return telegramRequest("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export async function downloadTelegramFile(fileId: string) {
  const file = await telegramRequest<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
  if (!file.file_path) throw new Error("Telegram file path is unavailable");
  const response = await fetch(`https://api.telegram.org/file/bot${telegramToken()}/${file.file_path}`);
  if (!response.ok) throw new Error("Unable to download Telegram attachment");
  return {
    bytes: await response.arrayBuffer(),
    filePath: file.file_path,
    fileSize: file.file_size || Number(response.headers.get("content-length") || 0),
  };
}
