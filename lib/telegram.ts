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

/** The one text button we keep, so the menu is always one tap away. */
export const MAIN_MENU_LABEL = "☰ القائمة الرئيسية";

export function telegramMainKeyboard(): TelegramReplyMarkup {
  return {
    keyboard: [[{ text: MAIN_MENU_LABEL }]],
    resize_keyboard: true,
    is_persistent: true,
  };
}

const MANAGEMENT_ROLES = new Set(["رئيس المقيمين", "الإدارة العليا", "مطور النظام"]);
const PATIENT_ROLES = new Set(["طبيب مقيم", "رئيس المقيمين", "الحسابات", "الإدارة العليا", "مطور النظام"]);
const HANDOVER_ROLES = new Set(["طبيب مقيم", "رئيس المقيمين", "مطور النظام"]);

/** Verified bot admins are hospital operators, so they see every button. */
function allows(isBotAdmin: boolean, role: string, roles: Set<string>) {
  return isBotAdmin || roles.has(role);
}

export function telegramCommandMenu(isBotAdmin = false, role = ""): TelegramReplyMarkup {
  const inlineKeyboard = [
    [{ text: "🟢 تسجيل حضور", callback_data: "menu:checkin" }, { text: "🔴 تسجيل انصراف", callback_data: "menu:checkout" }],
    [{ text: "👤 حالتي الآن", callback_data: "menu:status" }, { text: "📋 مهامي المفتوحة", callback_data: "menu:tasks" }],
    [{ text: "▶️ بدء متابعة مهمة", callback_data: "menu:followup" }, { text: "✅ إنهاء مهمة", callback_data: "menu:done" }],
    [{ text: "➕ إضافة مهمة", callback_data: "menu:task" }],
  ];
  if (allows(isBotAdmin, role, MANAGEMENT_ROLES)) inlineKeyboard.push([{ text: "🏥 الموجودون الآن", callback_data: "menu:present" }]);
  if (allows(isBotAdmin, role, PATIENT_ROLES)) {
    inlineKeyboard.push([{ text: "🧾 تسجيل مريضة", callback_data: "menu:patient" }]);
    inlineKeyboard.push([{ text: "👶 إعادة دخول مولود", callback_data: "menu:readmit" }]);
  }
  if (allows(isBotAdmin, role, HANDOVER_ROLES)) inlineKeyboard.push([{ text: "🔄 تسليم مناوبة", callback_data: "menu:handover" }]);
  inlineKeyboard.push([{ text: "📎 إرفاق صورة أو PDF", callback_data: "menu:attach" }]);
  if (allows(isBotAdmin, role, MANAGEMENT_ROLES)) inlineKeyboard.push([{ text: "🔗 ربط موظف بالبوت", callback_data: "menu:linkstaff" }]);
  if (isBotAdmin) inlineKeyboard.push([{ text: "🛡️ طلبات مديري البوت", callback_data: "menu:adminrequests" }]);
  inlineKeyboard.push([{ text: "❓ شرح الاستخدام", callback_data: "menu:help" }]);
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
