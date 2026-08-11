import { buildNewbornNames, getBillingMode, getInitialPrice, isBirthEntry, MAX_NEWBORNS, parseNewbornCount } from "../../../../lib/rules-engine";
import { getSupabaseAdmin, readRuntimeVariable } from "../../../../lib/supabase-server";
import { createLinkCode } from "../../../../lib/telegram-link";
import { daysInMonth, weekdayName } from "../../../../lib/shift-planner";
import {
  MAIN_MENU_LABEL,
  answerTelegramCallback,
  downloadTelegramFile,
  sendTelegramMessage,
  telegramCommandMenu,
  telegramContactVerificationKeyboard,
  telegramMainKeyboard,
  type TelegramReplyMarkup,
} from "../../../../lib/telegram";
import {
  applyFlowInput,
  clearSession,
  loadSession,
  startFlow,
  type Flow,
  type FlowContext,
  type FlowInput,
  type FlowOption,
} from "../../../../lib/telegram-flows";

type Row = Record<string, unknown>;
type TelegramUser = { id: number; username?: string; first_name?: string; last_name?: string };
type TelegramDocument = { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
type TelegramPhoto = { file_id: string; file_size?: number; width: number; height: number };
type TelegramContact = { phone_number: string; first_name: string; last_name?: string; user_id?: number };
type TelegramMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: TelegramUser;
  text?: string;
  caption?: string;
  document?: TelegramDocument;
  photo?: TelegramPhoto[];
  contact?: TelegramContact;
};
type TelegramCallbackQuery = { id: string; from: TelegramUser; message?: TelegramMessage; data?: string };
type TelegramUpdate = { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery };
type LinkedEmployee = { accountId: number; employeeId: number; fullName: string; role: string; specialty: string; isBotAdmin: boolean };
type CommandResult = { text: string; employeeId?: number; isBotAdmin?: boolean; role?: string; replyMarkup?: TelegramReplyMarkup };
type AttachedFile = { fileId: string; fileName: string; mimeType: string; declaredSize: number };

const MANAGEMENT_ROLES = new Set(["رئيس المقيمين", "الإدارة العليا", "مطور النظام"]);
const PATIENT_ROLES = new Set(["طبيب مقيم", "رئيس المقيمين", "الحسابات", "الإدارة العليا", "مطور النظام"]);
const HANDOVER_ROLES = new Set(["طبيب مقيم", "رئيس المقيمين", "مطور النظام"]);
const MAX_TELEGRAM_FILE = 15 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]);
const FLOW_COMMANDS = new Set(["task", "followup", "done", "patient", "readmit", "handover", "attach", "linkstaff", "availability"]);

/**
 * Verified bot admins are the hospital's own operators, so they clear every
 * role gate. Every permission check in this file goes through here.
 */
function allows(actor: { role: string; isBotAdmin: boolean }, roles: Set<string>) {
  return actor.isBotAdmin || roles.has(actor.role);
}

function webhookSecretIsValid(request: Request) {
  const expected = readRuntimeVariable("TELEGRAM_WEBHOOK_SECRET") || "";
  const received = request.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!expected || expected.length !== received.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ received.charCodeAt(index);
  return difference === 0;
}

function baghdadDate(offsetDays = 0) {
  const moment = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(moment);
}

function formatTime(value: unknown) {
  if (!value) return "غير مسجل";
  return new Intl.DateTimeFormat("ar-IQ-u-nu-latn", {
    timeZone: "Asia/Baghdad", dateStyle: "short", timeStyle: "short",
  }).format(new Date(String(value)));
}

function parseCommand(rawText: string) {
  const text = rawText.trim();
  if (text === MAIN_MENU_LABEL) return { name: "menu", args: "" };
  const [head = "", ...tail] = text.split(/\s+/);
  if (!head.startsWith("/")) return { name: "unknown", args: text };
  return { name: head.slice(1).split("@")[0].toLowerCase(), args: tail.join(" ").trim() };
}

function helpText() {
  return [
    "بوت البياتي — كل شيء بالأزرار",
    "",
    "لا تحتاج لحفظ أي أمر. اضغط زر «☰ القائمة الرئيسية» أسفل الشاشة، ثم اختر ما تريد.",
    "",
    "• تسجيل الحضور والانصراف — ضغطة واحدة.",
    "• المهام — البوت يعرض لك مهامك كأزرار، تضغط على المهمة لبدء متابعتها أو إنهائها.",
    "• إضافة مهمة — البوت يسألك خطوة بخطوة: العنوان، ثم الموظف، ثم الأولوية، ثم الموعد.",
    "• تسجيل مريضة — أزرار لكل خطوة. في حالات الولادة لا يسأل عن الجنس (أنثى بالضرورة) ويسأل عن عدد المواليد.",
    "• إعادة دخول مولود — إذا عاد مولود بعد خروجه، يُفتح ملفه الأصلي المرتبط بأمه بدل تسجيله من جديد.",
    "• تسليم مناوبة — تختار الطبيب المستلم، ثم تحدد المرضى من قائمة أزرار.",
    "• إرفاق ملف — تختار الوجهة والتصنيف بالأزرار، ثم ترسل الصورة أو الـPDF.",
    "• أيام تفرّغي — تختار أيام الشهر القادم بالضغط عليها، فتصل مباشرة إلى رئيس المقيمين.",
    "• جدول المناوبات — للإدارة: ملخص من أرسل أيامه وتوزيع المناوبات الحالي.",
    "• ربط موظف — للإدارة ومديري البوت: تختار الموظف، والبوت يعطيك رابطًا جاهزًا ترسله له.",
    "",
    "أثناء أي عملية يظهر زر «✖️ إلغاء» للتراجع دون حفظ أي شيء.",
    "كل عملية تُحفظ في قاعدة البياتي مع اسم المنفذ والوقت والمصدر.",
  ].join("\n");
}

async function linkedEmployee(chatId: number, telegramUserId: number): Promise<LinkedEmployee | null> {
  const supabase = getSupabaseAdmin();
  const { data: account, error } = await supabase.from("telegram_accounts").select("id,employee_id,status,is_bot_admin")
    .eq("chat_id", chatId).eq("telegram_user_id", telegramUserId).maybeSingle();
  if (error) throw error;
  if (!account || account.status !== "معتمد") return null;
  const { data: employee, error: employeeError } = await supabase.from("employees").select("id,full_name,role,specialty,status")
    .eq("id", account.employee_id).maybeSingle();
  if (employeeError) throw employeeError;
  if (!employee || employee.status !== "نشط") return null;
  await supabase.from("telegram_accounts").update({ last_seen_at: new Date().toISOString() }).eq("id", account.id);
  return {
    accountId: Number(account.id),
    employeeId: Number(employee.id),
    fullName: String(employee.full_name),
    role: String(employee.role),
    specialty: String(employee.specialty),
    isBotAdmin: Boolean(account.is_bot_admin),
  };
}

async function recordActivity(employee: LinkedEmployee, activityType: string, description: string, entityType?: string, entityId?: string | number, metadata: Row = {}) {
  const { error } = await getSupabaseAdmin().rpc("record_employee_activity", {
    p_employee_name: employee.fullName,
    p_activity_type: activityType,
    p_description: description,
    p_entity_type: entityType || null,
    p_entity_id: entityId === undefined ? null : String(entityId),
    p_source: "telegram",
    p_metadata: metadata,
  });
  if (error) throw error;
}

async function pairAccount(message: TelegramMessage, code: string): Promise<CommandResult> {
  if (!message.from || !code) return { text: "اطلب من الإدارة رمز ربط مؤقتًا ثم أرسله هكذا: /link 123456" };
  const supabase = getSupabaseAdmin();
  const { data: link, error } = await supabase.from("telegram_link_codes").select("id,employee_id,expires_at,used_at")
    .eq("code", code).is("used_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) throw error;
  if (!link) return { text: "رمز الربط غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا من الإدارة." };

  const { data: existingUser, error: existingError } = await supabase.from("telegram_accounts").select("employee_id")
    .eq("telegram_user_id", message.from.id).maybeSingle();
  if (existingError) throw existingError;
  if (existingUser && Number(existingUser.employee_id) !== Number(link.employee_id)) {
    return { text: "حساب Telegram هذا مرتبط بموظف آخر. راجع الإدارة لتغيير الربط." };
  }

  await supabase.from("telegram_accounts").delete().eq("employee_id", link.employee_id);
  const displayName = [message.from.first_name, message.from.last_name].filter(Boolean).join(" ");
  const { error: insertError } = await supabase.from("telegram_accounts").insert({
    employee_id: link.employee_id,
    telegram_user_id: message.from.id,
    chat_id: message.chat.id,
    username: message.from.username || null,
    display_name: displayName || null,
    status: "معتمد",
    is_bot_admin: false,
  });
  if (insertError) throw insertError;
  await supabase.from("telegram_link_codes").update({ used_at: new Date().toISOString() }).eq("id", link.id);

  const { data: employee, error: employeeError } = await supabase.from("employees").select("full_name,role")
    .eq("id", link.employee_id).single();
  if (employeeError) throw employeeError;
  const linked: LinkedEmployee = {
    accountId: 0,
    employeeId: Number(link.employee_id),
    fullName: String(employee.full_name),
    role: String(employee.role),
    specialty: "",
    isBotAdmin: false,
  };
  await recordActivity(linked, "ربط Telegram", "ربط حسابه ببوت البياتي", "telegram_account", String(link.employee_id));
  return {
    text: `تم الربط بنجاح يا ${employee.full_name}.\nصلاحيتك: ${employee.role}\nاضغط على أي زر للبدء.`,
    employeeId: Number(link.employee_id),
    isBotAdmin: false,
    role: String(employee.role),
    replyMarkup: telegramCommandMenu(false, String(employee.role)),
  };
}

function normalizePhoneNumber(value: string) {
  let digits = value.replace(/[^0-9]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `964${digits.slice(1)}`;
  if (!digits.startsWith("964")) digits = `964${digits}`;
  return `+${digits}`;
}

function telegramDisplayName(user: TelegramUser) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || (user.username ? `@${user.username}` : `Telegram ${user.id}`);
}

async function registerUnlinkedStart(message: TelegramMessage): Promise<CommandResult> {
  if (!message.from) return { text: "تعذر تحديد حساب Telegram المرسل." };
  const supabase = getSupabaseAdmin();
  const username = message.from.username?.toLowerCase() || "";
  if (username) {
    const { data: allowed, error } = await supabase.from("telegram_bot_admin_allowlist").select("status")
      .ilike("telegram_username", username).maybeSingle();
    if (error) throw error;
    if (allowed && allowed.status !== "ملغى") {
      return {
        text: "تم التعرف على حسابك ضمن مديري البوت المعتمدين. لإكمال التفعيل بأمان اضغط الزر وشارك رقمك المسجل. لا يُحفظ أي رقم جديد غير الرقم المعتمد في النظام.",
        replyMarkup: telegramContactVerificationKeyboard(),
      };
    }
  }
  return {
    text: "لا تمتلك الصلاحيات لاستخدام بوت البياتي. إذا كان رقمك معتمدًا مسبقًا من الإدارة، اضغط زر التحقق وشارك رقم حسابك أنت.",
    replyMarkup: telegramContactVerificationKeyboard(),
  };
}

async function verifyBootstrapAdmin(message: TelegramMessage): Promise<CommandResult> {
  if (!message.from || !message.contact) return { text: "لم تصل جهة اتصال صالحة للتحقق." };
  if (message.contact.user_id && message.contact.user_id !== message.from.id) {
    return { text: "يجب مشاركة رقم حسابك أنت، وليس جهة اتصال لشخص آخر." };
  }
  const username = message.from.username?.toLowerCase() || "";
  const phoneNumber = normalizePhoneNumber(message.contact.phone_number);
  const supabase = getSupabaseAdmin();
  const { data: allowed, error } = await supabase.from("telegram_bot_admin_allowlist").select("id,employee_id,telegram_username,phone_number,status")
    .eq("phone_number", phoneNumber).maybeSingle();
  if (error) throw error;
  if (!allowed || allowed.status === "ملغى") return { text: "لا تمتلك الصلاحيات لاستخدام بوت البياتي." };
  if (allowed.telegram_username && String(allowed.telegram_username).toLowerCase() !== username) {
    return { text: "لا تمتلك الصلاحيات لاستخدام بوت البياتي. اسم الحساب لا يطابق الحساب المعتمد لهذا الرقم." };
  }

  await supabase.from("telegram_accounts").delete().eq("employee_id", allowed.employee_id);
  await supabase.from("telegram_accounts").delete().eq("telegram_user_id", message.from.id);
  const { data: account, error: accountError } = await supabase.from("telegram_accounts").insert({
    employee_id: allowed.employee_id,
    telegram_user_id: message.from.id,
    chat_id: message.chat.id,
    username: message.from.username || null,
    display_name: telegramDisplayName(message.from),
    status: "معتمد",
    is_bot_admin: true,
  }).select("id").single();
  if (accountError) throw accountError;
  const { error: allowlistError } = await supabase.from("telegram_bot_admin_allowlist").update({
    status: "تم التحقق",
    telegram_user_id: message.from.id,
    verified_at: new Date().toISOString(),
  }).eq("id", allowed.id);
  if (allowlistError) throw allowlistError;
  await supabase.from("telegram_bot_admin_requests").update({
    status: "مقبول",
    reviewed_by: allowed.employee_id,
    reviewed_at: new Date().toISOString(),
  }).eq("telegram_user_id", message.from.id);

  const { data: employee, error: employeeError } = await supabase.from("employees").select("full_name,role,specialty").eq("id", allowed.employee_id).single();
  if (employeeError) throw employeeError;
  const linked: LinkedEmployee = {
    accountId: Number(account.id),
    employeeId: Number(allowed.employee_id),
    fullName: String(employee.full_name),
    role: String(employee.role),
    specialty: String(employee.specialty),
    isBotAdmin: true,
  };
  await recordActivity(linked, "اعتماد مدير البوت", "تحقق من اسم Telegram ورقم الهاتف وأصبح مديرًا لبوت البياتي", "telegram_account", account.id);
  return {
    text: `تم التحقق بنجاح يا ${linked.fullName}. أصبحت الآن مديرًا لبوت البياتي. اختر ما تريد من الأزرار:`,
    employeeId: linked.employeeId,
    isBotAdmin: true,
    role: linked.role,
    replyMarkup: telegramCommandMenu(true, linked.role),
  };
}

async function botAdminRequests(employee: LinkedEmployee): Promise<CommandResult> {
  if (!employee.isBotAdmin) return { text: "هذه القائمة مخصصة لمديري البوت المعتمدين فقط.", employeeId: employee.employeeId };
  const { data, error } = await getSupabaseAdmin().from("telegram_bot_admin_requests").select("id,username,display_name,requested_at")
    .eq("status", "بانتظار الموافقة").order("requested_at", { ascending: true }).limit(20);
  if (error) throw error;
  if (!data?.length) return { text: "لا توجد طلبات إدارة بوت معلّقة الآن.", employeeId: employee.employeeId, isBotAdmin: true, role: employee.role };
  const rows = data.flatMap((request) => [[
    { text: `✅ اعتماد ${request.username ? `@${request.username}` : request.display_name}`, callback_data: `adminapprove:${request.id}` },
    { text: "✖️ رفض", callback_data: `adminreject:${request.id}` },
  ]]);
  return {
    text: ["طلبات إدارة البوت المعلقة:", ...data.map((request) => `#${request.id} · ${request.display_name}${request.username ? ` · @${request.username}` : ""}`)].join("\n"),
    employeeId: employee.employeeId,
    isBotAdmin: true,
    role: employee.role,
    replyMarkup: { inline_keyboard: rows },
  };
}

async function reviewBotAdminRequest(employee: LinkedEmployee, requestIdText: string, decision: "مقبول" | "مرفوض") {
  if (!employee.isBotAdmin) return "هذه العملية مخصصة لمديري البوت المعتمدين فقط.";
  const requestId = Number(requestIdText);
  if (!Number.isInteger(requestId) || requestId <= 0) return "معرّف الطلب غير صحيح.";
  const supabase = getSupabaseAdmin();
  const { data: request, error } = await supabase.from("telegram_bot_admin_requests").select("*")
    .eq("id", requestId).eq("status", "بانتظار الموافقة").maybeSingle();
  if (error) throw error;
  if (!request) return "الطلب غير موجود أو تمت مراجعته مسبقًا.";
  if (decision === "مرفوض") {
    const { error: rejectError } = await supabase.from("telegram_bot_admin_requests").update({
      status: "مرفوض", reviewed_by: employee.employeeId, reviewed_at: new Date().toISOString(),
    }).eq("id", requestId);
    if (rejectError) throw rejectError;
    await sendTelegramMessage(Number(request.chat_id), "تم رفض طلب إدارة بوت البياتي. راجع إدارة المستشفى إذا كان ذلك غير صحيح.");
    await recordActivity(employee, "رفض مدير بوت", `رفض طلب إدارة البوت #${requestId}`, "telegram_admin_request", requestId);
    return `تم رفض الطلب #${requestId}.`;
  }

  const employeeNumber = `BOT-REQUEST-${requestId}`;
  const { data: approvedEmployee, error: employeeError } = await supabase.from("employees").upsert({
    full_name: request.display_name || (request.username ? `@${request.username}` : `مدير بوت ${requestId}`),
    employee_number: employeeNumber,
    username: `telegram.bot.admin.${request.telegram_user_id}`,
    role: "مدير بوت",
    specialty: "إدارة بوت البياتي",
    join_date: baghdadDate(),
    status: "نشط",
    approval_status: "معتمد",
  }, { onConflict: "employee_number" }).select("id,full_name").single();
  if (employeeError) throw employeeError;
  await supabase.from("telegram_accounts").delete().eq("telegram_user_id", request.telegram_user_id);
  await supabase.from("telegram_accounts").delete().eq("employee_id", approvedEmployee.id);
  const { error: accountError } = await supabase.from("telegram_accounts").insert({
    employee_id: approvedEmployee.id,
    telegram_user_id: request.telegram_user_id,
    chat_id: request.chat_id,
    username: request.username,
    display_name: request.display_name,
    status: "معتمد",
    is_bot_admin: true,
  });
  if (accountError) throw accountError;
  const { error: approveError } = await supabase.from("telegram_bot_admin_requests").update({
    status: "مقبول", reviewed_by: employee.employeeId, reviewed_at: new Date().toISOString(),
  }).eq("id", requestId);
  if (approveError) throw approveError;
  await sendTelegramMessage(Number(request.chat_id), "تمت الموافقة عليك كمدير لبوت البياتي. اضغط «☰ القائمة الرئيسية» للبدء.", telegramMainKeyboard());
  await recordActivity(employee, "اعتماد مدير بوت", `اعتمد ${approvedEmployee.full_name} مديرًا لبوت البياتي`, "telegram_admin_request", requestId);
  return `تم اعتماد ${approvedEmployee.full_name} مديرًا للبوت.`;
}

async function attendance(employee: LinkedEmployee, action: "دخول" | "خروج") {
  const { error } = await getSupabaseAdmin().rpc("record_attendance_event", {
    p_employee_name: employee.fullName,
    p_action: action,
    p_source: "telegram",
    p_note: null,
    p_recorded_by_name: employee.fullName,
  });
  if (error) {
    if (error.message.includes("already clocked in")) return "أنت مسجل حضور بالفعل.";
    if (error.message.includes("not clocked in")) return "لا يوجد حضور مفتوح لتسجيل الانصراف.";
    throw error;
  }
  return action === "دخول" ? `تم تسجيل حضورك الآن يا ${employee.fullName}.` : `تم تسجيل انصرافك الآن يا ${employee.fullName}.`;
}

async function presenceList(employee: LinkedEmployee) {
  if (!allows(employee, MANAGEMENT_ROLES)) return "قائمة الموجودين الآن متاحة للإدارة العليا ورئيس المقيمين فقط.";
  const { data, error } = await getSupabaseAdmin().from("employee_presence_overview").select("full_name,role,clock_in_at,last_activity,last_activity_at")
    .eq("is_present", true).order("clock_in_at", { ascending: true });
  if (error) throw error;
  if (!data?.length) return "لا يوجد موظفون مسجلون حضورًا الآن.";
  return [
    `الموجودون الآن: ${data.length}`,
    ...data.slice(0, 25).map((row, index) => `${index + 1}. ${row.full_name} — ${row.role}\n   منذ ${formatTime(row.clock_in_at)} · ${row.last_activity || "لا نشاط بعد"}`),
  ].join("\n");
}

async function personalStatus(employee: LinkedEmployee) {
  const supabase = getSupabaseAdmin();
  const [{ data: presence, error: presenceError }, { count, error: tasksError }] = await Promise.all([
    supabase.from("employee_presence_overview").select("is_present,clock_in_at,last_activity,last_activity_at").eq("employee_id", employee.employeeId).maybeSingle(),
    supabase.from("operational_tasks").select("id", { count: "exact", head: true }).eq("assigned_employee_id", employee.employeeId).neq("status", "مكتملة").neq("status", "ملغاة"),
  ]);
  if (presenceError) throw presenceError;
  if (tasksError) throw tasksError;
  return [
    `${employee.fullName} — ${employee.role}`,
    `الحضور: ${presence?.is_present ? `موجود منذ ${formatTime(presence.clock_in_at)}` : "غير موجود حاليًا"}`,
    `المهام المفتوحة: ${count || 0}`,
    `آخر نشاط: ${presence?.last_activity || "لا يوجد نشاط مسجل"}`,
    presence?.last_activity_at ? `وقت النشاط: ${formatTime(presence.last_activity_at)}` : "",
  ].filter(Boolean).join("\n");
}

async function taskList(employee: LinkedEmployee) {
  const { data, error } = await getSupabaseAdmin().from("operational_tasks").select("id,title,status,priority,due_at")
    .eq("assigned_employee_id", employee.employeeId).neq("status", "مكتملة").neq("status", "ملغاة")
    .order("due_at", { ascending: true, nullsFirst: false }).limit(20);
  if (error) throw error;
  if (!data?.length) return "لا توجد لديك مهام مفتوحة الآن.";
  return ["مهامك المفتوحة:", ...data.map((task) => `#${task.id} · ${task.title}\n${task.status} · ${task.priority}${task.due_at ? ` · ${formatTime(task.due_at)}` : ""}`)].join("\n\n");
}

/* ------------------------------------------------------------------ */
/* Option loaders — every guided step is filled from real data.        */
/* ------------------------------------------------------------------ */

async function assignableEmployeeOptions(context: FlowContext): Promise<FlowOption[]> {
  const self: FlowOption = { label: `👤 ${context.fullName} (أنا)`, value: String(context.employeeId) };
  if (!allows(context, MANAGEMENT_ROLES)) return [self];
  const { data, error } = await getSupabaseAdmin().from("employees").select("id,full_name,role")
    .eq("status", "نشط").order("full_name").limit(30);
  if (error) throw error;
  const others = (data || [])
    .filter((employee) => Number(employee.id) !== context.employeeId)
    .map((employee) => ({ label: `${employee.full_name} — ${employee.role}`, value: String(employee.id) }));
  return [self, ...others];
}

async function openTaskOptions(context: FlowContext): Promise<FlowOption[]> {
  let query = getSupabaseAdmin().from("operational_tasks").select("id,title,priority")
    .neq("status", "مكتملة").neq("status", "ملغاة");
  if (!allows(context, MANAGEMENT_ROLES)) query = query.eq("assigned_employee_id", context.employeeId);
  const { data, error } = await query.order("id", { ascending: false }).limit(25);
  if (error) throw error;
  return (data || []).map((task) => ({ label: `#${task.id} · ${task.title}`.slice(0, 60), value: String(task.id) }));
}

async function residentDoctorOptions(context: FlowContext): Promise<FlowOption[]> {
  const { data, error } = await getSupabaseAdmin().from("employees").select("id,full_name")
    .eq("role", "طبيب مقيم").eq("status", "نشط").order("full_name").limit(30);
  if (error) throw error;
  return (data || [])
    .filter((doctor) => Number(doctor.id) !== context.employeeId)
    .map((doctor) => ({ label: String(doctor.full_name), value: String(doctor.full_name) }));
}

async function attendingDoctorOptions(context: FlowContext): Promise<FlowOption[]> {
  const { data, error } = await getSupabaseAdmin().from("employees").select("id,full_name")
    .eq("role", "طبيب مقيم").eq("status", "نشط").order("full_name").limit(30);
  if (error) throw error;
  const doctors = (data || []).map((doctor) => ({ label: String(doctor.full_name), value: String(doctor.full_name) }));
  return [{ label: `👤 ${context.fullName} (أنا)`, value: context.fullName }, ...doctors.filter((doctor) => doctor.value !== context.fullName)];
}

async function activePatientOptions(): Promise<FlowOption[]> {
  const { data, error } = await getSupabaseAdmin().from("patients").select("file_number,full_name,department")
    .neq("patient_status", "خرجت").eq("is_newborn", false).order("id", { ascending: false }).limit(30);
  if (error) throw error;
  return (data || []).map((patient) => ({ label: `${patient.full_name} · ${patient.file_number}`.slice(0, 60), value: String(patient.file_number) }));
}

type ReadmissionCandidate = {
  newborn_id: number; newborn_name: string; newborn_file_number: string;
  twin_order: number | null; discharge_date: string | null;
  mother_id: number; mother_name: string; mother_file_number: string;
};

async function readmissionCandidates(motherId?: number) {
  let query = getSupabaseAdmin().from("newborn_readmission_candidates")
    .select("newborn_id,newborn_name,newborn_file_number,twin_order,discharge_date,mother_id,mother_name,mother_file_number");
  if (motherId) query = query.eq("mother_id", motherId);
  const { data, error } = await query.order("discharge_date", { ascending: false }).limit(60);
  if (error) throw error;
  return (data || []) as ReadmissionCandidate[];
}

async function readmissionMotherOptions(): Promise<FlowOption[]> {
  const candidates = await readmissionCandidates();
  const mothers = new Map<number, ReadmissionCandidate>();
  for (const candidate of candidates) if (!mothers.has(candidate.mother_id)) mothers.set(candidate.mother_id, candidate);
  return [...mothers.values()].map((candidate) => ({
    label: `${candidate.mother_name} · ${candidate.mother_file_number}`.slice(0, 60),
    value: String(candidate.mother_id),
  }));
}

async function readmissionNewbornOptions(context: FlowContext): Promise<FlowOption[]> {
  const candidates = await readmissionCandidates(Number(context.data.motherId));
  return candidates.map((candidate) => ({
    label: `${candidate.newborn_name}${candidate.twin_order ? ` (${candidate.twin_order})` : ""} · ${candidate.newborn_file_number}`.slice(0, 60),
    value: String(candidate.newborn_id),
  }));
}

async function unlinkedEmployeeOptions(): Promise<FlowOption[]> {
  const supabase = getSupabaseAdmin();
  const [{ data: employees, error }, { data: accounts, error: accountsError }] = await Promise.all([
    supabase.from("employees").select("id,full_name,role").eq("status", "نشط").order("full_name").limit(50),
    supabase.from("telegram_accounts").select("employee_id").eq("status", "معتمد"),
  ]);
  if (error) throw error;
  if (accountsError) throw accountsError;
  const linked = new Set((accounts || []).map((account) => Number(account.employee_id)));
  return (employees || [])
    .filter((employee) => !linked.has(Number(employee.id)))
    .map((employee) => ({ label: `${employee.full_name} — ${employee.role}`, value: String(employee.id) }));
}

function staticOptions(values: string[]): () => Promise<FlowOption[]> {
  return async () => values.map((value) => ({ label: value, value }));
}

async function dueDateOptions(): Promise<FlowOption[]> {
  return [
    { label: "اليوم", value: baghdadDate(0) },
    { label: "غدًا", value: baghdadDate(1) },
    { label: "بعد 3 أيام", value: baghdadDate(3) },
    { label: "بعد أسبوع", value: baghdadDate(7) },
    { label: "بدون موعد", value: "" },
  ];
}

/* ------------------------------------------------------------------ */
/* Actions — called once a guided flow has collected everything.       */
/* ------------------------------------------------------------------ */

async function nextFileNumber() {
  // ponytail: scans the newest 500 file numbers; add a DB sequence if the archive outgrows that.
  const { data, error } = await getSupabaseAdmin().from("patients").select("file_number")
    .like("file_number", "P-%").order("id", { ascending: false }).limit(500);
  if (error) throw error;
  const highest = (data || []).reduce((maximum, row) => {
    const parsed = Number(String(row.file_number).slice(2));
    return Number.isFinite(parsed) && parsed > maximum ? parsed : maximum;
  }, 0);
  return `P-${String(highest + 1).padStart(4, "0")}`;
}

async function finishTask(employee: LinkedEmployee, context: FlowContext) {
  const title = String(context.data.title || "").trim();
  const assigneeId = Number(context.data.assigneeId);
  const priority = String(context.data.priority || "اعتيادية");
  const dueDate = String(context.data.dueAt || "");
  if (!title || !Number.isInteger(assigneeId)) return "تعذر إنشاء المهمة: بيانات ناقصة. ابدأ من جديد.";
  const supabase = getSupabaseAdmin();
  const { data: assignee, error: assigneeError } = await supabase.from("employees").select("id,full_name")
    .eq("id", assigneeId).eq("status", "نشط").maybeSingle();
  if (assigneeError) throw assigneeError;
  if (!assignee) return "الموظف المحدد لم يعد نشطًا. ابدأ من جديد.";
  const { data: task, error } = await supabase.from("operational_tasks").insert({
    title,
    assigned_employee_id: Number(assignee.id),
    status: "مفتوحة",
    priority,
    due_at: dueDate ? `${dueDate}T12:00:00+03:00` : null,
    created_by: employee.employeeId,
    source: "telegram",
  }).select("id").single();
  if (error) throw error;
  await recordActivity(employee, "إنشاء مهمة", `أنشأ مهمة «${title}» وأسندها إلى ${assignee.full_name}`, "task", task.id, { assigneeId: assignee.id });
  return `✅ تم إنشاء المهمة #${task.id}\nالعنوان: ${title}\nالمسؤول: ${assignee.full_name}\nالأولوية: ${priority}\nالموعد: ${dueDate || "بدون موعد"}`;
}

async function finishTaskStatus(employee: LinkedEmployee, context: FlowContext, status: "قيد المتابعة" | "مكتملة") {
  const taskId = Number(context.data.taskId);
  if (!Number.isInteger(taskId) || taskId <= 0) return "لم يتم تحديد المهمة. ابدأ من جديد.";
  const supabase = getSupabaseAdmin();
  const { data: task, error } = await supabase.from("operational_tasks").select("id,title,assigned_employee_id").eq("id", taskId).maybeSingle();
  if (error) throw error;
  if (!task) return "المهمة غير موجودة.";
  if (Number(task.assigned_employee_id) !== employee.employeeId && !allows(employee, MANAGEMENT_ROLES)) return "لا يمكنك تعديل مهمة مسندة إلى موظف آخر.";
  const update = status === "مكتملة"
    ? { status, completed_at: new Date().toISOString(), completed_by: employee.employeeId }
    : { status, completed_at: null, completed_by: null };
  const { error: updateError } = await supabase.from("operational_tasks").update(update).eq("id", taskId);
  if (updateError) throw updateError;
  await recordActivity(employee, status === "مكتملة" ? "إكمال مهمة" : "متابعة مهمة", `${status === "مكتملة" ? "أكمل" : "بدأ متابعة"} المهمة «${task.title}»`, "task", taskId);
  return status === "مكتملة" ? `✅ تم إنهاء المهمة #${taskId} — ${task.title}` : `▶️ المهمة #${taskId} أصبحت قيد المتابعة — ${task.title}`;
}

async function finishPatient(employee: LinkedEmployee, context: FlowContext) {
  if (!allows(employee, PATIENT_ROLES)) return "صلاحيتك لا تسمح بتسجيل المرضى.";
  const fullName = String(context.data.fullName || "").trim();
  const requestedFile = String(context.data.fileNumber || "auto").trim();
  const department = String(context.data.department || "");
  const entryType = String(context.data.entryType || "");
  const attendingDoctor = String(context.data.attendingDoctor || employee.fullName);
  // A birth case is always the mother's file, so the bot never asks for gender there.
  const gender = isBirthEntry(entryType) ? "أنثى" : String(context.data.gender || "");
  const newbornCount = isBirthEntry(entryType) ? parseNewbornCount(context.data.newbornCount) : 0;
  if (newbornCount === null) return `عدد المواليد غير صحيح. أرسل رقمًا بين 0 و${MAX_NEWBORNS}، أو ابدأ من جديد.`;
  const newbornNames = buildNewbornNames(fullName, newbornCount);
  if (!fullName || !gender || !department || !entryType) return "تعذر التسجيل: بيانات ناقصة. ابدأ من جديد.";
  const fileNumber = requestedFile === "auto" ? await nextFileNumber() : requestedFile;

  const { data, error } = await getSupabaseAdmin().rpc("register_patient", {
    p_full_name: fullName,
    p_file_number: fileNumber,
    p_birth_date: null,
    p_gender: gender,
    p_phone: "",
    p_admission_date: baghdadDate(),
    p_department: department,
    p_attending_doctor: attendingDoctor,
    p_payment_category: "نقدي",
    p_entry_type: entryType,
    p_billing_mode: getBillingMode(entryType),
    p_notes: `مسجل عبر بوت البياتي بواسطة ${employee.fullName}`,
    p_initial_price: getInitialPrice(entryType),
    p_newborn_names: newbornNames,
  });
  if (error) {
    if (error.code === "23505" || error.message.includes("duplicate key")) return `رقم الملف ${fileNumber} مسجل مسبقًا. ابدأ من جديد واختر «توليد رقم تلقائي».`;
    throw error;
  }
  const result = data as { record?: Row };
  await recordActivity(employee, "تسجيل مريض", `أنشأ ملف المريض ${fullName} عبر البوت`, "patient", String(result.record?.id || ""), { fileNumber, entryType, newbornCount });
  return [
    `✅ تم تسجيل ${fullName}`,
    `رقم الملف: ${fileNumber}`,
    `القسم: ${department}`,
    `نوع الدخول: ${entryType}`,
    `الطبيب: ${attendingDoctor}`,
    newbornNames.length ? `المواليد (${newbornNames.length}): ${newbornNames.join("، ")}\nكل مولود له ملف مستقل مرتبط بملف الأم.` : "",
  ].filter(Boolean).join("\n");
}

async function finishReadmission(employee: LinkedEmployee, context: FlowContext) {
  if (!allows(employee, PATIENT_ROLES)) return "صلاحيتك لا تسمح بتسجيل دخول المرضى.";
  const newbornId = Number(context.data.newbornId);
  if (!Number.isInteger(newbornId) || newbornId <= 0) return "لم يتم تحديد المولود. ابدأ من جديد.";
  const { data, error } = await getSupabaseAdmin().rpc("readmit_newborn", {
    p_newborn_id: newbornId,
    p_department: String(context.data.department || ""),
    p_attending_doctor: employee.fullName,
    p_notes: String(context.data.notes || ""),
    p_recorded_by: employee.fullName,
  });
  if (error) {
    if (error.message.includes("already admitted")) return "هذا المولود مسجل حاليًا كنشط — لا حاجة لإعادة الدخول.";
    throw error;
  }
  const result = data as { record?: Row; mother?: Row };
  await recordActivity(employee, "إعادة دخول مولود", `أعاد إدخال ${result.record?.full_name} على ملفه المرتبط بالأم`, "patient", String(result.record?.id || ""), { motherId: result.mother?.id });
  return [
    `✅ تم تسجيل عودة ${result.record?.full_name}`,
    `على ملفه الأصلي: ${result.record?.file_number}`,
    `مرتبط بملف الأم: ${result.mother?.full_name} · ${result.mother?.file_number}`,
    `القسم: ${result.record?.department}`,
    "",
    "لم يُنشأ أي ملف جديد — نفس السجل أُعيد فتحه وسُجّلت العودة في تاريخه.",
  ].join("\n");
}

async function finishHandover(employee: LinkedEmployee, context: FlowContext) {
  if (!allows(employee, HANDOVER_ROLES)) return "صلاحيتك لا تسمح بتسليم المناوبات.";
  const toDoctorName = String(context.data.toDoctor || "");
  const fileNumbers = Array.isArray(context.data.patients) ? (context.data.patients as string[]) : [];
  const notes = String(context.data.notes || "");
  if (!toDoctorName || !fileNumbers.length) return "تعذر التسليم: لم تُحدد الطبيب المستلم أو المرضى.";
  const supabase = getSupabaseAdmin();
  const { data: patients, error: patientsError } = await supabase.from("patients").select("id,file_number")
    .in("file_number", fileNumbers).neq("patient_status", "خرجت");
  if (patientsError) throw patientsError;
  if (!patients?.length) return "لم أجد ملفات مرضى نشطة ضمن اختيارك.";
  const { data: handover, error } = await supabase.rpc("create_shift_handover", {
    p_from_doctor_name: employee.fullName,
    p_to_doctor_name: toDoctorName,
    p_patient_ids: patients.map((patient) => Number(patient.id)),
    p_notes: notes || null,
  });
  if (error) throw error;
  const record = handover as Row;
  await recordActivity(employee, "تسليم مناوبة", `سلّم ${patients.length} مريضًا إلى ${toDoctorName} عبر البوت`, "doctor_shift_handover", String(record.id || ""), { fileNumbers });
  return `✅ تم التسليم إلى ${toDoctorName}\nعدد المرضى: ${patients.length}${notes ? `\nملاحظة: ${notes}` : ""}`;
}

async function finishAttachment(employee: LinkedEmployee, context: FlowContext) {
  const entityType = String(context.data.entityType || "");
  const entityRef = String(context.data.entityRef || "");
  const category = String(context.data.category || "");
  const file = context.data.file as AttachedFile | undefined;
  if (!entityType || !entityRef || !category || !file?.fileId) return "تعذر الحفظ: بيانات ناقصة. ابدأ من جديد.";
  if (!ALLOWED_ATTACHMENT_MIME.has(file.mimeType)) return "الملفات المدعومة هي الصور وPDF فقط.";
  if (file.declaredSize > MAX_TELEGRAM_FILE) return "حجم الملف يتجاوز 15MB.";

  const supabase = getSupabaseAdmin();
  let entityId = "";
  let bucketName = "patient-files";
  if (entityType === "patient") {
    const { data, error } = await supabase.from("patients").select("id").eq("file_number", entityRef).maybeSingle();
    if (error) throw error;
    if (!data) return "ملف المريضة لم يعد موجودًا.";
    entityId = String(data.id);
  } else if (entityType === "employee") {
    if (!allows(employee, MANAGEMENT_ROLES) && entityRef !== String(employee.employeeId)) return "يمكنك إرفاق مستنداتك فقط؛ الإدارة تستطيع إرفاق مستندات الآخرين.";
    const { data, error } = await supabase.from("employees").select("id").eq("id", Number(entityRef)).maybeSingle();
    if (error) throw error;
    if (!data) return "الموظف غير موجود.";
    entityId = String(data.id);
    bucketName = "employee-files";
  } else {
    const { data, error } = await supabase.from("operational_tasks").select("id,assigned_employee_id").eq("id", Number(entityRef)).maybeSingle();
    if (error) throw error;
    if (!data) return "المهمة غير موجودة.";
    if (Number(data.assigned_employee_id) !== employee.employeeId && !allows(employee, MANAGEMENT_ROLES)) return "لا يمكنك إرفاق ملف بمهمة موظف آخر.";
    entityId = String(data.id);
  }

  const downloaded = await downloadTelegramFile(file.fileId);
  if (downloaded.bytes.byteLength > MAX_TELEGRAM_FILE) return "حجم الملف يتجاوز 15MB.";
  const extension = file.fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || (file.mimeType === "application/pdf" ? "pdf" : "jpg");
  const objectPath = `${entityType}/${entityId}/${baghdadDate().slice(0, 7)}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from(bucketName).upload(objectPath, downloaded.bytes, { contentType: file.mimeType, upsert: false });
  if (uploadError) throw uploadError;
  const { data: attachment, error: metadataError } = await supabase.from("file_attachments").insert({
    bucket_name: bucketName,
    object_path: objectPath,
    entity_type: entityType,
    entity_id: entityId,
    category,
    original_filename: file.fileName,
    mime_type: file.mimeType,
    size_bytes: downloaded.bytes.byteLength,
    uploaded_by: employee.employeeId,
    uploaded_by_name: employee.fullName,
    metadata: { uploadSource: "telegram", telegramFileId: file.fileId },
  }).select("id").single();
  if (metadataError) {
    await supabase.storage.from(bucketName).remove([objectPath]);
    throw metadataError;
  }
  await recordActivity(employee, "إرفاق ملف", `أرفق ${category} عبر البوت`, entityType, entityId, { attachmentId: attachment.id });
  return `✅ تم حفظ الملف ضمن «${category}» وربطه بالسجل.`;
}

/** Next month, as the roster always plans ahead. */
function nextMonthKey() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    key: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`,
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    label: new Intl.DateTimeFormat("ar-IQ", { month: "long", year: "numeric", timeZone: "UTC" }).format(next),
  };
}

async function availabilityDayOptions(): Promise<FlowOption[]> {
  const target = nextMonthKey();
  const total = daysInMonth(target.year, target.month);
  return Array.from({ length: total }, (_, index) => {
    const day = index + 1;
    return { label: `${String(day).padStart(2, "0")} ${weekdayName(target.year, target.month, day).slice(0, 3)}`, value: String(day) };
  });
}

async function finishAvailability(employee: LinkedEmployee, context: FlowContext) {
  const target = nextMonthKey();
  const days = Array.isArray(context.data.days) ? (context.data.days as string[]).map(Number).sort((a, b) => a - b) : [];
  if (!days.length) return "لم تحدد أي يوم. ابدأ من جديد واختر أيام تفرغك.";
  const preferred = String(context.data.preferredShift || "كلاهما");

  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase.from("shift_months").select("id,status").eq("month", target.key).maybeSingle();
  let monthId = existing?.id;
  if (existing?.status === "منشور") return `تم نشر جدول ${target.label} بالفعل — راجع رئيس المقيمين لأي تعديل.`;
  if (!monthId) {
    const { data, error } = await supabase.from("shift_months").insert({ month: target.key }).select("id").single();
    if (error) throw error;
    monthId = data.id;
  }
  const { error } = await supabase.from("shift_availability").upsert({
    month_id: monthId,
    employee_id: employee.employeeId,
    available_days: days,
    preferred_shift: preferred,
    submitted_at: new Date().toISOString(),
  }, { onConflict: "month_id,employee_id" });
  if (error) throw error;

  await recordActivity(employee, "إرسال أيام التفرغ", `أرسل ${days.length} يوم تفرغ لشهر ${target.label} عبر البوت`, "shift_month", String(monthId), { days, preferred });
  return [
    `✅ وصلت أيام تفرغك لشهر ${target.label}`,
    `عدد الأيام: ${days.length}`,
    `الأيام: ${days.join("، ")}`,
    `المناوبة المفضلة: ${preferred}`,
    "",
    "سيصلك جدولك هنا فور اعتماده من رئيس المقيمين.",
  ].join("\n");
}

async function rosterSummary(employee: LinkedEmployee) {
  const target = nextMonthKey();
  const supabase = getSupabaseAdmin();
  const { data: month } = await supabase.from("shift_months").select("id,status,morning_start,evening_start").eq("month", target.key).maybeSingle();
  if (!month) return `لم يبدأ إعداد جدول ${target.label} بعد.`;
  const [{ data: assignments }, { data: availability }, { data: residents }] = await Promise.all([
    supabase.from("shift_schedule_overview").select("work_date,shift,full_name").eq("month_id", month.id).order("work_date"),
    supabase.from("shift_availability").select("employee_id").eq("month_id", month.id),
    supabase.from("employees").select("id").eq("role", "طبيب مقيم").eq("status", "نشط"),
  ]);
  if (!assignments?.length) {
    return [
      `📅 جدول ${target.label} — ${month.status}`,
      `أرسل أيامه: ${availability?.length || 0} من ${residents?.length || 0} طبيبًا`,
      "",
      "لم يُولَّد الجدول بعد. افتح «جدول المناوبات» في الموقع واضغط «توليد الجدول تلقائيًا».",
    ].join("\n");
  }
  const counts = new Map<string, number>();
  for (const row of assignments) counts.set(String(row.full_name), (counts.get(String(row.full_name)) || 0) + 1);
  return [
    `📅 جدول ${target.label} — ${month.status}`,
    `إجمالي المناوبات: ${assignments.length}`,
    "",
    ...[...counts.entries()].sort((left, right) => right[1] - left[1]).map(([name, count]) => `• ${name}: ${count} مناوبة`),
    "",
    month.status === "منشور" ? "الجدول منشور ووصل الأطباء." : "للنشر والإرسال عبر واتساب افتح «جدول المناوبات» في الموقع.",
  ].join("\n");
}

async function finishLinkStaff(employee: LinkedEmployee, context: FlowContext) {
  if (!allows(employee, MANAGEMENT_ROLES)) return "ربط الموظفين متاح للإدارة ومديري البوت فقط.";
  const targetId = Number(context.data.employeeId);
  if (!Number.isInteger(targetId) || targetId <= 0) return "لم يتم تحديد الموظف. ابدأ من جديد.";
  const { data: target, error } = await getSupabaseAdmin().from("employees").select("id,full_name,role")
    .eq("id", targetId).eq("status", "نشط").maybeSingle();
  if (error) throw error;
  if (!target) return "الموظف لم يعد نشطًا.";
  const link = await createLinkCode(targetId, employee.employeeId);
  await recordActivity(employee, "إنشاء رمز ربط", `أنشأ رمز ربط لحساب ${target.full_name}`, "telegram_account", targetId);
  return [
    `🔗 رمز ربط ${target.full_name} — ${target.role}`,
    "",
    `الرمز: ${link.code}`,
    `الرابط المباشر: ${link.deepLink}`,
    "",
    `أرسل الرابط للموظف. بمجرد فتحه يُربط حسابه تلقائيًا بصلاحيته في النظام.`,
    `صالح لمدة ${link.ttlMinutes} دقيقة ولمرة واحدة فقط.`,
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Guided flows — every step is a button unless free text is unavoidable. */
/* ------------------------------------------------------------------ */

async function attachEntityOptions(context: FlowContext): Promise<FlowOption[]> {
  const entityType = String(context.data.entityType || "");
  if (entityType === "patient") return activePatientOptions();
  if (entityType === "task") return openTaskOptions(context);
  const self: FlowOption = { label: `👤 ${context.fullName} (أنا)`, value: String(context.employeeId) };
  if (!allows(context, MANAGEMENT_ROLES)) return [self];
  const { data, error } = await getSupabaseAdmin().from("employees").select("id,full_name").eq("status", "نشط").order("full_name").limit(30);
  if (error) throw error;
  const others = (data || [])
    .filter((employee) => Number(employee.id) !== context.employeeId)
    .map((employee) => ({ label: String(employee.full_name), value: String(employee.id) }));
  return [self, ...others];
}

function buildFlows(employee: LinkedEmployee): Record<string, Flow> {
  return {
    task: {
      title: "➕ إضافة مهمة",
      steps: [
        { key: "title", prompt: "ما هو عنوان المهمة؟", kind: "text" },
        { key: "assigneeId", prompt: "من المسؤول عن تنفيذها؟", kind: "choice", options: assignableEmployeeOptions },
        { key: "priority", prompt: "ما هي أولوية المهمة؟", kind: "choice", options: staticOptions(["اعتيادية", "مهمة", "عاجلة"]) },
        { key: "dueAt", prompt: "متى موعد التسليم؟", kind: "choice", options: dueDateOptions },
      ],
      finish: (context) => finishTask(employee, context),
    },
    followup: {
      title: "▶️ بدء متابعة مهمة",
      steps: [{ key: "taskId", prompt: "اختر المهمة التي تريد بدء متابعتها:", kind: "choice", options: openTaskOptions }],
      finish: (context) => finishTaskStatus(employee, context, "قيد المتابعة"),
    },
    done: {
      title: "✅ إنهاء مهمة",
      steps: [{ key: "taskId", prompt: "اختر المهمة التي أنجزتها:", kind: "choice", options: openTaskOptions }],
      finish: (context) => finishTaskStatus(employee, context, "مكتملة"),
    },
    patient: {
      title: "🧾 تسجيل مريضة",
      steps: [
        // Entry type comes first: it decides whether gender and newborn count are even asked.
        { key: "entryType", prompt: "نوع الدخول؟", kind: "choice", options: staticOptions(["استشارية", "ولادة طبيعية", "عملية قيصرية", "رقود"]) },
        { key: "fullName", prompt: "ما هو اسم المريضة الكامل؟", kind: "text" },
        {
          key: "fileNumber",
          prompt: "رقم الملف؟",
          kind: "choice",
          allowText: true,
          options: async () => [{ label: "🔢 توليد رقم تلقائي", value: "auto" }],
        },
        {
          key: "gender",
          prompt: "الجنس؟",
          kind: "choice",
          options: staticOptions(["أنثى", "ذكر"]),
          when: (context) => !isBirthEntry(String(context.data.entryType || "")),
        },
        {
          key: "newbornCount",
          prompt: "كم عدد المواليد؟",
          kind: "choice",
          allowText: true,
          options: async () => [
            { label: "مولود واحد", value: "1" },
            { label: "توأم (2)", value: "2" },
            { label: "ثلاثة توائم", value: "3" },
            { label: "أربعة توائم", value: "4" },
            { label: "يُسجل لاحقًا", value: "0" },
          ],
          when: (context) => isBirthEntry(String(context.data.entryType || "")),
        },
        {
          key: "department",
          prompt: "القسم الطبي؟",
          kind: "choice",
          options: staticOptions(["النسائية والتوليد", "الجراحة العامة", "الطب الباطني", "طب الأطفال", "الطوارئ", "العناية المركزة"]),
        },
        { key: "attendingDoctor", prompt: "الطبيب المسؤول؟", kind: "choice", options: attendingDoctorOptions },
      ],
      finish: (context) => finishPatient(employee, context),
    },
    readmit: {
      title: "👶 إعادة دخول مولود",
      steps: [
        { key: "motherId", prompt: "اختر ملف الأم:", kind: "choice", options: readmissionMotherOptions },
        { key: "newbornId", prompt: "أي مولود عاد إلى المستشفى؟", kind: "choice", options: readmissionNewbornOptions },
        {
          key: "department",
          prompt: "إلى أي قسم يدخل؟",
          kind: "choice",
          options: staticOptions(["حديثو الولادة", "طب الأطفال", "العناية المركزة", "الطوارئ"]),
        },
        { key: "notes", prompt: "سبب العودة أو أي ملاحظة؟", kind: "text", optional: true },
      ],
      finish: (context) => finishReadmission(employee, context),
    },
    handover: {
      title: "🔄 تسليم مناوبة",
      steps: [
        { key: "toDoctor", prompt: "من هو الطبيب المستلم؟", kind: "choice", options: residentDoctorOptions },
        { key: "patients", prompt: "حدّد المرضى المسلَّمين:", kind: "multi", options: activePatientOptions },
        { key: "notes", prompt: "أي ملاحظة للطبيب المستلم؟", kind: "text", optional: true },
      ],
      finish: (context) => finishHandover(employee, context),
    },
    attach: {
      title: "📎 إرفاق ملف",
      steps: [
        {
          key: "entityType",
          prompt: "بماذا تريد ربط الملف؟",
          kind: "choice",
          options: async () => [
            { label: "🧾 مريضة", value: "patient" },
            { label: "👤 موظف", value: "employee" },
            { label: "📋 مهمة", value: "task" },
          ],
        },
        { key: "entityRef", prompt: "اختر السجل:", kind: "choice", options: attachEntityOptions },
        {
          key: "category",
          prompt: "ما تصنيف الملف؟",
          kind: "choice",
          options: staticOptions(["تحاليل", "أشعة", "تقرير طبي", "وصفة علاجية", "وثيقة إدارية", "أخرى"]),
        },
        { key: "file", prompt: "أرسل الآن الصورة أو ملف الـPDF.", kind: "file" },
      ],
      finish: (context) => finishAttachment(employee, context),
    },
    availability: {
      title: "◷ أيام التفرّغ",
      steps: [
        { key: "days", prompt: `حدّد الأيام التي تستطيع فيها استلام مناوبة في ${nextMonthKey().label}:`, kind: "multi", options: availabilityDayOptions },
        { key: "preferredShift", prompt: "أي مناوبة تفضّل؟", kind: "choice", options: staticOptions(["كلاهما", "صباحية", "مسائية"]) },
      ],
      finish: (context) => finishAvailability(employee, context),
    },
    linkstaff: {
      title: "🔗 ربط موظف بالبوت",
      steps: [{ key: "employeeId", prompt: "اختر الموظف الذي تريد ربط حسابه بالبوت:", kind: "choice", options: unlinkedEmployeeOptions }],
      finish: (context) => finishLinkStaff(employee, context),
    },
  };
}

function flowContext(employee: LinkedEmployee): FlowContext {
  return {
    employeeId: employee.employeeId,
    fullName: employee.fullName,
    role: employee.role,
    isBotAdmin: employee.isBotAdmin,
    data: {},
  };
}

function menuResult(employee: LinkedEmployee, text: string): CommandResult {
  return {
    text,
    employeeId: employee.employeeId,
    isBotAdmin: employee.isBotAdmin,
    role: employee.role,
    replyMarkup: telegramCommandMenu(employee.isBotAdmin, employee.role),
  };
}

async function executeCommand(employee: LinkedEmployee, chatId: number, telegramUserId: number, commandName: string): Promise<CommandResult> {
  if (FLOW_COMMANDS.has(commandName)) {
    if ((commandName === "patient" || commandName === "readmit") && !allows(employee, PATIENT_ROLES)) return menuResult(employee, "صلاحيتك لا تسمح بتسجيل المرضى.");
    if (commandName === "handover" && !allows(employee, HANDOVER_ROLES)) return menuResult(employee, "صلاحيتك لا تسمح بتسليم المناوبات.");
    if (commandName === "linkstaff" && !allows(employee, MANAGEMENT_ROLES)) return menuResult(employee, "ربط الموظفين متاح للإدارة ومديري البوت فقط.");
    const flow = buildFlows(employee)[commandName];
    const context = flowContext(employee);
    const firstStep = flow.steps[0];
    if (firstStep.options) {
      const available = await firstStep.options(context);
      if (!available.length) return menuResult(employee, `لا توجد عناصر متاحة لبدء «${flow.title}» الآن.`);
    }
    const reply = await startFlow(chatId, telegramUserId, commandName, flow, context);
    return { text: reply.text, employeeId: employee.employeeId, isBotAdmin: employee.isBotAdmin, role: employee.role, replyMarkup: reply.replyMarkup };
  }

  if (commandName === "roster") {
    if (!allows(employee, MANAGEMENT_ROLES)) return menuResult(employee, "ملخص الجدول متاح للإدارة ورئيس المقيمين.");
    return menuResult(employee, await rosterSummary(employee));
  }
  if (commandName === "adminrequests") return botAdminRequests(employee);
  let text: string;
  if (commandName === "checkin") text = await attendance(employee, "دخول");
  else if (commandName === "checkout") text = await attendance(employee, "خروج");
  else if (commandName === "present") text = await presenceList(employee);
  else if (commandName === "status") text = await personalStatus(employee);
  else if (commandName === "tasks") text = await taskList(employee);
  else if (commandName === "help") text = helpText();
  else if (commandName === "menu") text = "اختر العملية المطلوبة:";
  else text = "اختر العملية المطلوبة من الأزرار:";
  return menuResult(employee, text);
}

/** Feeds one answer into the running flow. Returns null when no flow is waiting for it. */
async function routeFlowInput(employee: LinkedEmployee, chatId: number, telegramUserId: number, input: FlowInput): Promise<CommandResult | null> {
  const session = await loadSession(chatId);
  if (!session) return null;
  const flow = buildFlows(employee)[session.flow];
  if (!flow) {
    await clearSession(chatId);
    return null;
  }
  const context = flowContext(employee);
  const reply = await applyFlowInput(chatId, telegramUserId, flow, session, context, input);
  if (!reply) return null;
  return {
    text: reply.text,
    employeeId: employee.employeeId,
    isBotAdmin: employee.isBotAdmin,
    role: employee.role,
    replyMarkup: reply.finished ? telegramCommandMenu(employee.isBotAdmin, employee.role) : reply.replyMarkup,
  };
}

function attachmentInput(message: TelegramMessage): AttachedFile | null {
  if (message.document) return {
    fileId: message.document.file_id,
    fileName: message.document.file_name || "telegram-file",
    mimeType: message.document.mime_type || "application/octet-stream",
    declaredSize: message.document.file_size || 0,
  };
  const photo = message.photo?.at(-1);
  if (photo) return { fileId: photo.file_id, fileName: "telegram-photo.jpg", mimeType: "image/jpeg", declaredSize: photo.file_size || 0 };
  return null;
}

async function processMessage(message: TelegramMessage): Promise<CommandResult> {
  if (message.contact) return verifyBootstrapAdmin(message);
  if (!message.from) return { text: "تعذر تحديد حساب Telegram المرسل." };
  const rawText = message.text || message.caption || "";
  const command = parseCommand(rawText);

  if (["start", "link"].includes(command.name) && command.args) return pairAccount(message, command.args);
  const employee = await linkedEmployee(message.chat.id, message.from.id);
  if (["start", "link"].includes(command.name)) {
    if (!employee) return registerUnlinkedStart(message);
    await clearSession(message.chat.id);
    return menuResult(employee, `مرحبًا ${employee.fullName}.\nصلاحيتك: ${employee.role}\n\nاختر العملية المطلوبة — كل شيء بالأزرار:`);
  }
  if (!employee) return { text: "لا تمتلك الصلاحيات لاستخدام بوت البياتي. راجع إدارة المستشفى لربط حسابك." };

  // The single text button always wins, so a stuck flow is never a trap.
  if (command.name === "menu") {
    await clearSession(message.chat.id);
    return menuResult(employee, "اختر العملية المطلوبة:");
  }

  const file = attachmentInput(message);
  const flowReply = await routeFlowInput(employee, message.chat.id, message.from.id,
    file ? { kind: "file", file: file as unknown as Record<string, unknown> } : { kind: "text", text: rawText });
  if (flowReply) return flowReply;

  if (command.name === "unknown" || !command.name) {
    return menuResult(employee, "لا حاجة للكتابة — اختر ما تريد من الأزرار:");
  }
  return executeCommand(employee, message.chat.id, message.from.id, command.name);
}

async function processCallback(callback: TelegramCallbackQuery): Promise<CommandResult> {
  if (!callback.message) return { text: "تعذر تحديد محادثة الزر." };
  const chatId = callback.message.chat.id;
  const employee = await linkedEmployee(chatId, callback.from.id);
  if (!employee) return { text: "هذا الحساب غير مربوط بالنظام. أرسل /start أولًا." };
  const [scope, value = ""] = (callback.data || "").split(":");

  if (scope === "s") {
    const input: FlowInput = value === "cancel" ? { kind: "cancel" }
      : value === "skip" ? { kind: "skip" }
      : value === "done" ? { kind: "done" }
      : { kind: "index", index: Number(value) };
    const reply = await routeFlowInput(employee, chatId, callback.from.id, input);
    return reply || menuResult(employee, "انتهت هذه العملية. اختر ما تريد:");
  }

  if (scope === "adminapprove" || scope === "adminreject") {
    const text = await reviewBotAdminRequest(employee, value, scope === "adminapprove" ? "مقبول" : "مرفوض");
    return menuResult(employee, text);
  }

  await clearSession(chatId);
  return executeCommand(employee, chatId, callback.from.id, scope === "menu" ? value : "menu");
}

export async function POST(request: Request) {
  if (!webhookSecretIsValid(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let updateId: number | null = null;
  try {
    const update = await request.json() as TelegramUpdate;
    updateId = Number(update.update_id);
    const message = update.message || update.callback_query?.message;
    if (!Number.isInteger(updateId) || !message) return Response.json({ ok: true });
    const supabase = getSupabaseAdmin();
    const command = update.callback_query?.data || parseCommand(message.text || message.caption || "").name;
    const { data: existing, error: lookupError } = await supabase.from("telegram_updates").select("status")
      .eq("update_id", updateId).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing?.status === "تمت المعالجة") return Response.json({ ok: true, duplicate: true });
    if (!existing) {
      const { error: insertError } = await supabase.from("telegram_updates").insert({
        update_id: updateId,
        chat_id: message.chat.id,
        command,
        payload: update,
        status: "مستلم",
      });
      if (insertError) throw insertError;
    } else {
      await supabase.from("telegram_updates").update({ status: "مستلم", error_message: null }).eq("update_id", updateId);
    }

    const result = update.callback_query ? await processCallback(update.callback_query) : await processMessage(message);
    await sendTelegramMessage(message.chat.id, result.text, result.replyMarkup || telegramMainKeyboard());
    if (update.callback_query) await answerTelegramCallback(update.callback_query.id);
    const { error: processedError } = await supabase.from("telegram_updates").update({
      employee_id: result.employeeId || null,
      status: "تمت المعالجة",
      processed_at: new Date().toISOString(),
      error_message: null,
    }).eq("update_id", updateId);
    if (processedError) throw processedError;
    return Response.json({ ok: true });
  } catch (error) {
    if (updateId !== null) {
      try {
        await getSupabaseAdmin().from("telegram_updates").update({
          status: "فشل",
          error_message: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
          processed_at: new Date().toISOString(),
        }).eq("update_id", updateId);
      } catch { /* best-effort diagnostic logging */ }
    }
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
