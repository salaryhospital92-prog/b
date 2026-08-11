import { readRuntimeVariable } from "./supabase-server";

export type TelegramReplyMarkup = Record<string, unknown>;

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

export function telegramMainKeyboard(isBotAdmin = false): TelegramReplyMarkup {
  const keyboard = [
    [{ text: "تسجيل حضور" }, { text: "تسجيل انصراف" }],
    [{ text: "حالتي" }, { text: "من موجود الآن" }],
    [{ text: "مهامي" }, { text: "إضافة مهمة" }],
    [{ text: "متابعة مهمة" }, { text: "إنهاء مهمة" }],
    [{ text: "تسجيل مريض" }, { text: "تسليم مناوبة" }],
    [{ text: "إرفاق ملف" }, { text: "قائمة الأوامر" }],
  ];
  if (isBotAdmin) keyboard.push([{ text: "طلبات مديري البوت" }]);
  return {
    keyboard,
    resize_keyboard: true,
    is_persistent: true,
  };
}

export function telegramCommandMenu(isBotAdmin = false): TelegramReplyMarkup {
  const inlineKeyboard = [
    [{ text: "🟢 تسجيل حضور", callback_data: "menu:checkin" }, { text: "خروج", callback_data: "menu:checkout" }],
    [{ text: "حالتي الآن", callback_data: "menu:status" }, { text: "الموجودون الآن", callback_data: "menu:present" }],
    [{ text: "مهامي المفتوحة", callback_data: "menu:tasks" }, { text: "إضافة مهمة", callback_data: "menu:task" }],
    [{ text: "متابعة مهمة", callback_data: "menu:followup" }, { text: "إنهاء مهمة", callback_data: "menu:done" }],
    [{ text: "تسجيل مريض", callback_data: "menu:patient" }, { text: "تسليم مناوبة", callback_data: "menu:handover" }],
    [{ text: "إرفاق صورة أو PDF", callback_data: "menu:attach" }, { text: "دليل الأوامر", callback_data: "menu:help" }],
  ];
  if (isBotAdmin) inlineKeyboard.push([{ text: "طلبات مديري البوت", callback_data: "menu:adminrequests" }]);
  return { inline_keyboard: inlineKeyboard };
}

export function telegramContactVerificationKeyboard(): TelegramReplyMarkup {
  return {
    keyboard: [[{ text: "مشاركة رقمي والتحقق", request_contact: true }], [{ text: "إلغاء" }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

export async function sendTelegramMessage(chatId: number, text: string, replyMarkup?: TelegramReplyMarkup) {
  return telegramRequest("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export async function answerTelegramCallback(callbackQueryId: string, text = "تم تنفيذ الأمر") {
  return telegramRequest("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false,
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
