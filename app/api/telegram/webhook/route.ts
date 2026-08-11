import { getBillingMode, getInitialPrice } from "../../../../lib/rules-engine";
import { getSupabaseAdmin, readRuntimeVariable } from "../../../../lib/supabase-server";
import { downloadTelegramFile, sendTelegramMessage, telegramMainKeyboard } from "../../../../lib/telegram";

type Row = Record<string, unknown>;
type TelegramUser = { id: number; username?: string; first_name?: string; last_name?: string };
type TelegramDocument = { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
type TelegramPhoto = { file_id: string; file_size?: number; width: number; height: number };
type TelegramMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: TelegramUser;
  text?: string;
  caption?: string;
  document?: TelegramDocument;
  photo?: TelegramPhoto[];
};
type TelegramUpdate = { update_id: number; message?: TelegramMessage };
type LinkedEmployee = { accountId: number; employeeId: number; fullName: string; role: string; specialty: string };
type CommandResult = { text: string; employeeId?: number };

const MANAGEMENT_ROLES = new Set(["رئيس المقيمين", "الإدارة العليا", "مطور النظام"]);
const PATIENT_ROLES = new Set(["طبيب مقيم", "رئيس المقيمين", "الحسابات", "الإدارة العليا", "مطور النظام"]);
const MAX_TELEGRAM_FILE = 15 * 1024 * 1024;

function webhookSecretIsValid(request: Request) {
  const expected = readRuntimeVariable("TELEGRAM_WEBHOOK_SECRET") || "";
  const received = request.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!expected || expected.length !== received.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ received.charCodeAt(index);
  return difference === 0;
}

function baghdadDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function formatTime(value: unknown) {
  if (!value) return "غير مسجل";
  return new Intl.DateTimeFormat("ar-IQ-u-nu-latn", {
    timeZone: "Asia/Baghdad", dateStyle: "short", timeStyle: "short",
  }).format(new Date(String(value)));
}

function splitParts(value: string) {
  return value.split("|").map((part) => part.trim()).filter(Boolean);
}

function parseCommand(rawText: string) {
  const text = rawText.trim();
  const natural: Record<string, string> = {
    "تسجيل حضور": "checkin",
    "تسجيل انصراف": "checkout",
    "مهامي": "tasks",
    "حالتي": "status",
    "من موجود الآن": "present",
    "مساعدة": "help",
    "إضافة مريض": "patient",
    "تسليم مناوبة": "handover",
  };
  if (natural[text]) return { name: natural[text], args: "" };
  const [head = "", ...tail] = text.split(/\s+/);
  if (!head.startsWith("/")) return { name: "unknown", args: text };
  return { name: head.slice(1).split("@")[0].toLowerCase(), args: tail.join(" ").trim() };
}

function helpText() {
  return [
    "بوت البياتي — الأوامر المتاحة",
    "",
    "/checkin ملاحظة — تسجيل الحضور",
    "/checkout ملاحظة — تسجيل الانصراف",
    "/status — حالتي وآخر نشاط",
    "/present — الموظفون الموجودون الآن (للإدارة)",
    "/tasks — مهامي المفتوحة",
    "/task المهمة | اسم الموظف | 2026-08-12 | عاجلة — إنشاء مهمة",
    "/followup 12 — بدء متابعة مهمة",
    "/done 12 — إكمال مهمة",
    "/patient الاسم | رقم الملف | الجنس | القسم | نوع الدخول | الطبيب — تسجيل مريض",
    "/handover الطبيب المستلم | P-1001,P-1002 | ملاحظة — تسليم مرضى",
    "/attach patient | P-1001 | تحاليل — أرسلها كتعليق على صورة أو PDF",
    "",
    "كل عملية تُحفظ في قاعدة البياتي نفسها مع اسم المنفذ والوقت والمصدر.",
  ].join("\n");
}

async function linkedEmployee(chatId: number, telegramUserId: number): Promise<LinkedEmployee | null> {
  const supabase = getSupabaseAdmin();
  const { data: account, error } = await supabase.from("telegram_accounts").select("id,employee_id,status")
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
  };
  await recordActivity(linked, "ربط Telegram", "ربط حسابه ببوت البياتي", "telegram_account", String(link.employee_id));
  return {
    text: `تم الربط بنجاح يا ${employee.full_name}.\nصلاحيتك: ${employee.role}\nيمكنك الآن تنفيذ مهامك من بوت البياتي.`,
    employeeId: Number(link.employee_id),
  };
}

async function attendance(employee: LinkedEmployee, action: "دخول" | "خروج", note: string) {
  const { error } = await getSupabaseAdmin().rpc("record_attendance_event", {
    p_employee_name: employee.fullName,
    p_action: action,
    p_source: "telegram",
    p_note: note || null,
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
  if (!MANAGEMENT_ROLES.has(employee.role)) return "قائمة الموجودين الآن متاحة للإدارة العليا ورئيس المقيمين فقط.";
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
    supabase.from("employee_presence_overview").select("is_present,clock_in_at,last_activity,last_activity_at").eq("employee_id", employee.employeeId).single(),
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

async function createTask(employee: LinkedEmployee, args: string) {
  const [title, requestedAssignee, dueDate, requestedPriority] = splitParts(args);
  if (!title) return "الصيغة: /task المهمة | اسم الموظف | 2026-08-12 | عاجلة";
  const supabase = getSupabaseAdmin();
  let assignee = { id: employee.employeeId, full_name: employee.fullName };
  if (requestedAssignee && MANAGEMENT_ROLES.has(employee.role)) {
    const { data, error } = await supabase.from("employees").select("id,full_name").ilike("full_name", `%${requestedAssignee}%`).eq("status", "نشط").limit(1).maybeSingle();
    if (error) throw error;
    if (!data) return "لم أجد موظفًا نشطًا بالاسم المطلوب.";
    assignee = { id: Number(data.id), full_name: String(data.full_name) };
  }
  const priority = ["اعتيادية", "مهمة", "عاجلة"].includes(requestedPriority) ? requestedPriority : "اعتيادية";
  const dueAt = /^\d{4}-\d{2}-\d{2}$/.test(dueDate || "") ? `${dueDate}T12:00:00+03:00` : null;
  const { data: task, error } = await supabase.from("operational_tasks").insert({
    title,
    assigned_employee_id: assignee.id,
    status: "مفتوحة",
    priority,
    due_at: dueAt,
    created_by: employee.employeeId,
    source: "telegram",
  }).select("id").single();
  if (error) throw error;
  await recordActivity(employee, "إنشاء مهمة", `أنشأ مهمة «${title}» وأسندها إلى ${assignee.full_name}`, "task", task.id, { assigneeId: assignee.id });
  return `تم إنشاء المهمة #${task.id} وإسنادها إلى ${assignee.full_name}.`;
}

async function updateTask(employee: LinkedEmployee, args: string, status: "قيد المتابعة" | "مكتملة") {
  const taskId = Number(args.trim());
  if (!Number.isInteger(taskId) || taskId <= 0) return status === "مكتملة" ? "الصيغة: /done 12" : "الصيغة: /followup 12";
  const supabase = getSupabaseAdmin();
  const { data: task, error } = await supabase.from("operational_tasks").select("id,title,assigned_employee_id,status").eq("id", taskId).maybeSingle();
  if (error) throw error;
  if (!task) return "المهمة غير موجودة.";
  if (Number(task.assigned_employee_id) !== employee.employeeId && !MANAGEMENT_ROLES.has(employee.role)) return "لا يمكنك تعديل مهمة مسندة إلى موظف آخر.";
  const update = status === "مكتملة"
    ? { status, completed_at: new Date().toISOString(), completed_by: employee.employeeId }
    : { status, completed_at: null, completed_by: null };
  const { error: updateError } = await supabase.from("operational_tasks").update(update).eq("id", taskId);
  if (updateError) throw updateError;
  await recordActivity(employee, status === "مكتملة" ? "إكمال مهمة" : "متابعة مهمة", `${status === "مكتملة" ? "أكمل" : "بدأ متابعة"} المهمة «${task.title}»`, "task", taskId);
  return status === "مكتملة" ? `تم إكمال المهمة #${taskId}.` : `أصبحت المهمة #${taskId} قيد المتابعة.`;
}

async function registerPatient(employee: LinkedEmployee, args: string) {
  if (!PATIENT_ROLES.has(employee.role)) return "صلاحيتك لا تسمح بتسجيل المرضى.";
  const [fullName, fileNumber, gender, department, entryType, attendingDoctor] = splitParts(args);
  if (!fullName || !fileNumber || !gender || !department || !entryType) {
    return "الصيغة: /patient الاسم | رقم الملف | الجنس | القسم | نوع الدخول | الطبيب\nمثال: /patient زينب علي | P-1088 | أنثى | النسائية والتوليد | استشارية | د. أحمد البياتي";
  }
  const { data, error } = await getSupabaseAdmin().rpc("register_patient", {
    p_full_name: fullName,
    p_file_number: fileNumber,
    p_birth_date: null,
    p_gender: gender,
    p_phone: "",
    p_admission_date: baghdadDate(),
    p_department: department,
    p_attending_doctor: attendingDoctor || employee.fullName,
    p_payment_category: "نقدي",
    p_entry_type: entryType,
    p_billing_mode: getBillingMode(entryType),
    p_notes: `مسجل عبر بوت البياتي بواسطة ${employee.fullName}`,
    p_initial_price: getInitialPrice(entryType),
    p_newborn_names: [],
  });
  if (error) {
    if (error.code === "23505" || error.message.includes("duplicate key")) return "رقم الملف مسجل مسبقًا.";
    throw error;
  }
  const result = data as { record?: Row };
  await recordActivity(employee, "تسجيل مريض", `أنشأ ملف المريض ${fullName} عبر البوت`, "patient", String(result.record?.id || ""), { fileNumber, entryType });
  return `تم تسجيل المريض ${fullName} برقم الملف ${fileNumber}.`;
}

async function createHandover(employee: LinkedEmployee, args: string) {
  if (!["طبيب مقيم", "رئيس المقيمين", "مطور النظام"].includes(employee.role)) return "صلاحيتك لا تسمح بتسليم المناوبات.";
  const [toDoctorName, filesText, notes] = splitParts(args);
  const fileNumbers = (filesText || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!toDoctorName || !fileNumbers.length) return "الصيغة: /handover الطبيب المستلم | P-1001,P-1002 | ملاحظة";
  const supabase = getSupabaseAdmin();
  const { data: doctor, error: doctorError } = await supabase.from("employees").select("full_name")
    .ilike("full_name", `%${toDoctorName}%`).eq("role", "طبيب مقيم").eq("status", "نشط").limit(1).maybeSingle();
  if (doctorError) throw doctorError;
  if (!doctor) return "لم أجد الطبيب المستلم ضمن حسابات الأطباء النشطة.";
  const { data: patients, error: patientsError } = await supabase.from("patients").select("id,file_number")
    .in("file_number", fileNumbers).neq("patient_status", "خرجت");
  if (patientsError) throw patientsError;
  if (!patients?.length) return "لم أجد ملفات مرضى نشطة بالأرقام المرسلة.";
  const { data: handover, error } = await supabase.rpc("create_shift_handover", {
    p_from_doctor_name: employee.fullName,
    p_to_doctor_name: doctor.full_name,
    p_patient_ids: patients.map((patient) => Number(patient.id)),
    p_notes: notes || null,
  });
  if (error) throw error;
  const record = handover as Row;
  await recordActivity(employee, "تسليم مناوبة", `سلّم ${patients.length} مريضًا إلى ${doctor.full_name} عبر البوت`, "doctor_shift_handover", String(record.id || ""), { fileNumbers });
  const missing = fileNumbers.filter((file) => !patients.some((patient) => patient.file_number === file));
  return `تم إنشاء التسليم إلى ${doctor.full_name} لعدد ${patients.length} مريضًا.${missing.length ? `\nلم تُضمّن الملفات غير النشطة/غير الموجودة: ${missing.join(", ")}` : ""}`;
}

function attachmentInput(message: TelegramMessage) {
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

async function attachFile(employee: LinkedEmployee, message: TelegramMessage, args: string) {
  const input = attachmentInput(message);
  if (!input) return "أرسل صورة أو ملف PDF واكتب في التعليق: /attach patient | P-1001 | تحاليل";
  if (input.declaredSize > MAX_TELEGRAM_FILE) return "حجم الملف يتجاوز 15MB.";
  const [requestedType, requestedEntity, category] = splitParts(args);
  const entityType = requestedType?.toLowerCase();
  if (!entityType || !requestedEntity || !category || !["patient", "employee", "task"].includes(entityType)) {
    return "الصيغة: /attach patient | P-1001 | تحاليل\nالأنواع المدعومة: patient أو employee أو task";
  }

  const supabase = getSupabaseAdmin();
  let entityId = "";
  let bucketName = "patient-files";
  if (entityType === "patient") {
    const { data, error } = await supabase.from("patients").select("id").eq("file_number", requestedEntity).maybeSingle();
    if (error) throw error;
    if (!data) return "رقم ملف المريض غير موجود.";
    entityId = String(data.id);
  } else if (entityType === "employee") {
    if (!MANAGEMENT_ROLES.has(employee.role) && requestedEntity !== String(employee.employeeId)) return "يمكنك إرفاق مستنداتك فقط؛ الإدارة تستطيع إرفاق مستندات الآخرين.";
    const query = /^\d+$/.test(requestedEntity)
      ? supabase.from("employees").select("id").eq("id", Number(requestedEntity)).maybeSingle()
      : supabase.from("employees").select("id").ilike("full_name", `%${requestedEntity}%`).limit(1).maybeSingle();
    const { data, error } = await query;
    if (error) throw error;
    if (!data) return "الموظف غير موجود.";
    entityId = String(data.id);
    bucketName = "employee-files";
  } else {
    const taskId = Number(requestedEntity);
    const { data, error } = await supabase.from("operational_tasks").select("id,assigned_employee_id").eq("id", taskId).maybeSingle();
    if (error) throw error;
    if (!data) return "المهمة غير موجودة.";
    if (Number(data.assigned_employee_id) !== employee.employeeId && !MANAGEMENT_ROLES.has(employee.role)) return "لا يمكنك إرفاق ملف بمهمة موظف آخر.";
    entityId = String(data.id);
  }

  const allowedMime = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]);
  if (!allowedMime.has(input.mimeType)) return "الملفات المدعومة هي الصور وPDF فقط.";
  const downloaded = await downloadTelegramFile(input.fileId);
  if (downloaded.bytes.byteLength > MAX_TELEGRAM_FILE) return "حجم الملف يتجاوز 15MB.";
  const extension = input.fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || (input.mimeType === "application/pdf" ? "pdf" : "jpg");
  const objectPath = `${entityType}/${entityId}/${baghdadDate().slice(0, 7)}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from(bucketName).upload(objectPath, downloaded.bytes, { contentType: input.mimeType, upsert: false });
  if (uploadError) throw uploadError;
  const { data: attachment, error: metadataError } = await supabase.from("file_attachments").insert({
    bucket_name: bucketName,
    object_path: objectPath,
    entity_type: entityType,
    entity_id: entityId,
    category,
    original_filename: input.fileName,
    mime_type: input.mimeType,
    size_bytes: downloaded.bytes.byteLength,
    uploaded_by: employee.employeeId,
    uploaded_by_name: employee.fullName,
    metadata: { uploadSource: "telegram", telegramFileId: input.fileId },
  }).select("id").single();
  if (metadataError) {
    await supabase.storage.from(bucketName).remove([objectPath]);
    throw metadataError;
  }
  await recordActivity(employee, "إرفاق ملف", `أرفق ${category} عبر البوت`, entityType, entityId, { attachmentId: attachment.id });
  return `تم حفظ الملف ضمن ${category} وربطه بالسجل بنجاح.`;
}

async function processMessage(message: TelegramMessage): Promise<CommandResult> {
  const rawText = message.text || message.caption || "";
  const command = parseCommand(rawText);
  if (["start", "link"].includes(command.name) && command.args) {
    return pairAccount(message, command.args);
  }
  if (["start", "link"].includes(command.name) && !command.args) {
    if (!message.from) return { text: "تعذر تحديد حساب Telegram المرسل." };
    const existing = await linkedEmployee(message.chat.id, message.from.id);
    if (existing) return { text: `مرحبًا ${existing.fullName}.\nأنت مرتبط بنظام البياتي بصلاحية ${existing.role}.\n\n${helpText()}`, employeeId: existing.employeeId };
    return { text: "مرحبًا بك في بوت البياتي. اطلب من الإدارة رمز ربط مؤقتًا ثم أرسل: /link 123456" };
  }
  if (!message.from) return { text: "تعذر تحديد حساب Telegram المرسل." };
  const employee = await linkedEmployee(message.chat.id, message.from.id);
  if (!employee) return { text: "هذا الحساب غير مربوط بالنظام. اطلب من الإدارة رمزًا مؤقتًا ثم أرسل: /link 123456" };

  let text: string;
  if (command.name === "checkin") text = await attendance(employee, "دخول", command.args);
  else if (command.name === "checkout") text = await attendance(employee, "خروج", command.args);
  else if (command.name === "present") text = await presenceList(employee);
  else if (command.name === "status") text = await personalStatus(employee);
  else if (command.name === "tasks") text = await taskList(employee);
  else if (command.name === "task") text = await createTask(employee, command.args);
  else if (command.name === "followup") text = await updateTask(employee, command.args, "قيد المتابعة");
  else if (command.name === "done") text = await updateTask(employee, command.args, "مكتملة");
  else if (command.name === "patient") text = await registerPatient(employee, command.args);
  else if (command.name === "handover") text = await createHandover(employee, command.args);
  else if (command.name === "attach") text = await attachFile(employee, message, command.args);
  else if (command.name === "help") text = helpText();
  else text = `لم أفهم الأمر.\n\n${helpText()}`;
  return { text, employeeId: employee.employeeId };
}

export async function POST(request: Request) {
  if (!webhookSecretIsValid(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let updateId: number | null = null;
  try {
    const update = await request.json() as TelegramUpdate;
    updateId = Number(update.update_id);
    if (!Number.isInteger(updateId) || !update.message) return Response.json({ ok: true });
    const message = update.message;
    const supabase = getSupabaseAdmin();
    const command = parseCommand(message.text || message.caption || "").name;
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

    const result = await processMessage(message);
    await sendTelegramMessage(message.chat.id, result.text, telegramMainKeyboard());
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
