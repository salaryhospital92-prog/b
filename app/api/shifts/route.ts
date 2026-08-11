import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { authorizationFailure, authorizeEmployeeRequest } from "../../../lib/authorization";
import { recordEmployeeActivitySafely } from "../../../lib/activity";
import { sendTelegramMessage } from "../../../lib/telegram";
import {
  daysInMonth,
  formatDoctorShifts,
  formatWhatsappSchedule,
  planMonth,
  whatsappLink,
  type Assignment,
  type DoctorAvailability,
  type ShiftName,
} from "../../../lib/shift-planner";

type Row = Record<string, unknown>;

const CHIEF_ROLES = ["رئيس المقيمين", "الإدارة العليا", "مطور النظام"];
const ARABIC_MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** Accepts "2026-09" and returns the pieces every handler needs. */
function parseMonth(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month, key: `${match[1]}-${match[2]}-01`, label: `${ARABIC_MONTHS[month - 1]} ${year}` };
}

function defaultMonthKey() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function ensureMonth(monthKey: string) {
  const supabase = getSupabaseAdmin();
  const { data: existing, error } = await supabase.from("shift_months").select("*").eq("month", monthKey).maybeSingle();
  if (error) throw error;
  if (existing) return existing as Row;
  const { data, error: insertError } = await supabase.from("shift_months").insert({ month: monthKey }).select("*").single();
  if (insertError) throw insertError;
  return data as Row;
}

async function residentDoctors() {
  const { data, error } = await getSupabaseAdmin().from("employees").select("id,full_name,phone,specialty")
    .eq("role", "طبيب مقيم").eq("status", "نشط").order("full_name");
  if (error) throw error;
  return (data || []) as { id: number; full_name: string; phone: string | null; specialty: string }[];
}

async function loadMonthState(monthKey: string) {
  const supabase = getSupabaseAdmin();
  const month = await ensureMonth(monthKey);
  const [{ data: availability, error: availabilityError }, { data: assignments, error: assignmentsError }, doctors] = await Promise.all([
    supabase.from("shift_availability").select("*").eq("month_id", month.id),
    supabase.from("shift_assignments").select("*").eq("month_id", month.id).order("work_date"),
    residentDoctors(),
  ]);
  if (availabilityError) throw availabilityError;
  if (assignmentsError) throw assignmentsError;
  return { month, availability: (availability || []) as Row[], assignments: (assignments || []) as Row[], doctors };
}

function toAssignments(rows: Row[], doctors: { id: number; full_name: string }[]): Assignment[] {
  const names = new Map(doctors.map((doctor) => [Number(doctor.id), doctor.full_name]));
  return rows.map((row) => ({
    day: Number(String(row.work_date).slice(8, 10)),
    shift: String(row.shift) as ShiftName,
    employeeId: Number(row.employee_id),
    fullName: names.get(Number(row.employee_id)) || `#${row.employee_id}`,
  }));
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const actorName = url.searchParams.get("actorName")?.trim() || "";
    const actor = await authorizeEmployeeRequest(request, actorName);
    const parsed = parseMonth(url.searchParams.get("month") || defaultMonthKey());
    if (!parsed) return Response.json({ error: "صيغة الشهر غير صحيحة" }, { status: 400 });

    const state = await loadMonthState(parsed.key);
    const names = new Map(state.doctors.map((doctor) => [Number(doctor.id), doctor.full_name]));
    const assignments = toAssignments(state.assignments, state.doctors);
    const isChief = CHIEF_ROLES.includes(actor.role);

    return Response.json({
      month: { ...state.month, key: parsed.key, label: parsed.label, days: daysInMonth(parsed.year, parsed.month), year: parsed.year, monthNumber: parsed.month },
      canManage: isChief,
      me: {
        id: actor.id,
        fullName: actor.fullName,
        role: actor.role,
        isResident: actor.role === "طبيب مقيم",
        availability: state.availability.find((row) => Number(row.employee_id) === actor.id) || null,
        shifts: assignments.filter((item) => item.employeeId === actor.id),
      },
      doctors: state.doctors.map((doctor) => ({ id: doctor.id, fullName: doctor.full_name, phone: doctor.phone })),
      availability: state.availability.map((row) => ({ ...row, fullName: names.get(Number(row.employee_id)) || "" })),
      assignments,
      // Residents only see the plan once the chief publishes it.
      published: state.month.status === "منشور",
    });
  } catch (error) {
    return authorizationFailure(error, "تعذر تحميل جدول المناوبات");
  }
}

/** A resident submits (or updates) the days they can take a shift. */
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Row;
    const actor = await authorizeEmployeeRequest(request, clean(payload.actorName));
    const parsed = parseMonth(clean(payload.month));
    if (!parsed) return Response.json({ error: "صيغة الشهر غير صحيحة" }, { status: 400 });

    const total = daysInMonth(parsed.year, parsed.month);
    const days = Array.isArray(payload.availableDays) ? payload.availableDays : [];
    const availableDays = [...new Set(days.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= total))].sort((a, b) => a - b);
    if (!availableDays.length) return Response.json({ error: "اختر يومًا واحدًا على الأقل تستطيع فيه المناوبة" }, { status: 400 });

    const preferred = clean(payload.preferredShift) || "كلاهما";
    if (!["صباحية", "مسائية", "كلاهما"].includes(preferred)) {
      return Response.json({ error: "نوع المناوبة المفضل غير صحيح" }, { status: 400 });
    }
    const maxShiftsValue = Number(payload.maxShifts);
    const maxShifts = Number.isInteger(maxShiftsValue) && maxShiftsValue > 0 ? maxShiftsValue : null;

    const month = await ensureMonth(parsed.key);
    if (month.status === "منشور") {
      return Response.json({ error: "تم نشر جدول هذا الشهر — راجع رئيس المقيمين لأي تعديل" }, { status: 409 });
    }

    const { data, error } = await getSupabaseAdmin().from("shift_availability").upsert({
      month_id: month.id,
      employee_id: actor.id,
      available_days: availableDays,
      preferred_shift: preferred,
      max_shifts: maxShifts,
      note: clean(payload.note) || null,
      submitted_at: new Date().toISOString(),
    }, { onConflict: "month_id,employee_id" }).select("*").single();
    if (error) throw error;

    await recordEmployeeActivitySafely({
      employeeName: actor.fullName,
      activityType: "إرسال أيام التفرغ",
      description: `أرسل ${availableDays.length} يوم تفرغ لشهر ${parsed.label}`,
      entityType: "shift_month",
      entityId: String(month.id),
      source: "web",
      metadata: { month: parsed.key, preferred },
    });
    return Response.json({ availability: data, message: `تم إرسال أيام تفرغك لشهر ${parsed.label} إلى رئيس المقيمين` }, { status: 201 });
  } catch (error) {
    return authorizationFailure(error, "تعذر إرسال أيام التفرغ");
  }
}

/** The chief generates the roster, or saves a hand-edited one. */
export async function PUT(request: Request) {
  try {
    const payload = (await request.json()) as Row;
    const actor = await authorizeEmployeeRequest(request, clean(payload.actorName), CHIEF_ROLES);
    const parsed = parseMonth(clean(payload.month));
    if (!parsed) return Response.json({ error: "صيغة الشهر غير صحيحة" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const state = await loadMonthState(parsed.key);
    const doctorsPerShift = Math.max(1, Math.min(6, Number(payload.doctorsPerShift) || Number(state.month.doctors_per_shift) || 1));

    let assignments: Assignment[];
    let warnings: string[] = [];
    let gaps: { day: number; shift: ShiftName; missing: number }[] = [];
    let load: { employeeId: number; fullName: string; shifts: number; morning: number; evening: number }[] = [];

    if (Array.isArray(payload.assignments)) {
      // Manual save: the chief edited cells in the table.
      const names = new Map(state.doctors.map((doctor) => [Number(doctor.id), doctor.full_name]));
      assignments = (payload.assignments as Row[])
        .map((row) => ({
          day: Number(row.day),
          shift: String(row.shift) as ShiftName,
          employeeId: Number(row.employeeId),
          fullName: names.get(Number(row.employeeId)) || "",
        }))
        .filter((item) => item.fullName && item.day >= 1 && item.day <= daysInMonth(parsed.year, parsed.month) && (item.shift === "صباحية" || item.shift === "مسائية"));
    } else {
      const doctors: DoctorAvailability[] = state.availability.map((row) => ({
        employeeId: Number(row.employee_id),
        fullName: state.doctors.find((doctor) => Number(doctor.id) === Number(row.employee_id))?.full_name || "",
        availableDays: (Array.isArray(row.available_days) ? row.available_days : []).map(Number),
        preferredShift: String(row.preferred_shift) as DoctorAvailability["preferredShift"],
        maxShifts: row.max_shifts === null ? null : Number(row.max_shifts),
      })).filter((doctor) => doctor.fullName);
      const locked = toAssignments(state.assignments.filter((row) => row.is_locked), state.doctors);
      const plan = planMonth({ year: parsed.year, month: parsed.month, doctors, doctorsPerShift, locked });
      assignments = plan.assignments;
      warnings = plan.warnings;
      gaps = plan.gaps;
      load = plan.load;
    }

    await supabase.from("shift_assignments").delete().eq("month_id", state.month.id);
    if (assignments.length) {
      const { error } = await supabase.from("shift_assignments").insert(assignments.map((item) => ({
        month_id: state.month.id,
        employee_id: item.employeeId,
        work_date: `${parsed.key.slice(0, 8)}${String(item.day).padStart(2, "0")}`,
        shift: item.shift,
      })));
      if (error) throw error;
    }
    await supabase.from("shift_months").update({ status: "قيد الجدولة", doctors_per_shift: doctorsPerShift }).eq("id", state.month.id);

    await recordEmployeeActivitySafely({
      employeeName: actor.fullName,
      activityType: Array.isArray(payload.assignments) ? "تعديل جدول المناوبات" : "توليد جدول المناوبات",
      description: `${Array.isArray(payload.assignments) ? "حفظ تعديلات" : "ولّد"} جدول ${parsed.label} بعدد ${assignments.length} مناوبة`,
      entityType: "shift_month",
      entityId: String(state.month.id),
      source: "web",
    });
    return Response.json({ assignments, warnings, gaps, load, message: `تم تجهيز جدول ${parsed.label}` });
  } catch (error) {
    return authorizationFailure(error, "تعذر توليد الجدول");
  }
}

/** Publish: lock the month, notify every resident on Telegram, hand back WhatsApp text. */
export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as Row;
    const actor = await authorizeEmployeeRequest(request, clean(payload.actorName), CHIEF_ROLES);
    const parsed = parseMonth(clean(payload.month));
    if (!parsed) return Response.json({ error: "صيغة الشهر غير صحيحة" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const state = await loadMonthState(parsed.key);
    if (!state.assignments.length) return Response.json({ error: "لا يوجد جدول لنشره — ولّد الجدول أولًا" }, { status: 400 });

    const assignments = toAssignments(state.assignments, state.doctors);
    const monthConfig = {
      year: parsed.year,
      month: parsed.month,
      monthLabel: parsed.label,
      assignments,
      morningStart: String(state.month.morning_start || "08:00"),
      eveningStart: String(state.month.evening_start || "20:00"),
      shiftHours: Number(state.month.shift_hours || 12),
    };
    const whatsappText = formatWhatsappSchedule(monthConfig);

    await supabase.from("shift_months").update({
      status: "منشور",
      published_at: new Date().toISOString(),
      published_by: actor.id,
    }).eq("id", state.month.id);

    // In-app notification channel that actually reaches phones: the Telegram bot.
    const { data: accounts } = await supabase.from("telegram_accounts").select("employee_id,chat_id").eq("status", "معتمد");
    const chats = new Map((accounts || []).map((row) => [Number(row.employee_id), Number(row.chat_id)]));
    const notified: string[] = [];
    const shareLinks: { fullName: string; phone: string | null; shifts: number; whatsappLink: string | null; personalText: string }[] = [];

    for (const doctor of state.doctors) {
      const personalText = formatDoctorShifts({ ...monthConfig, fullName: doctor.full_name });
      const chatId = chats.get(Number(doctor.id));
      if (chatId) {
        try {
          await sendTelegramMessage(chatId, `📅 صدر جدول مناوبات ${parsed.label}\n\n${personalText}`);
          notified.push(doctor.full_name);
        } catch { /* a doctor with a stale chat must not block the publish */ }
      }
      shareLinks.push({
        fullName: doctor.full_name,
        phone: doctor.phone,
        shifts: assignments.filter((item) => item.employeeId === Number(doctor.id)).length,
        whatsappLink: doctor.phone ? whatsappLink(doctor.phone, `${parsed.label}\n${personalText}`) : null,
        personalText,
      });
    }

    await recordEmployeeActivitySafely({
      employeeName: actor.fullName,
      activityType: "نشر جدول المناوبات",
      description: `نشر جدول ${parsed.label} وأبلغ ${notified.length} طبيبًا عبر البوت`,
      entityType: "shift_month",
      entityId: String(state.month.id),
      source: "web",
    });

    return Response.json({
      message: `تم نشر جدول ${parsed.label}${notified.length ? ` وإشعار ${notified.length} طبيبًا عبر البوت` : ""}`,
      whatsappText,
      whatsappGroupLink: `https://wa.me/?text=${encodeURIComponent(whatsappText)}`,
      notified,
      shareLinks,
    });
  } catch (error) {
    return authorizationFailure(error, "تعذر نشر الجدول");
  }
}
