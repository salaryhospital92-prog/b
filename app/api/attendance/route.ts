import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { AuthorizationError, authorizationFailure, authorizeEmployeeRequest } from "../../../lib/authorization";

type Row = Record<string, unknown>;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function camelize(row: Row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]),
  );
}

function baghdadDayBounds() {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const start = new Date(`${today}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message || "تعذر تحديث سجل الحضور");
  if (message.includes("Employee already clocked in")) return "الموظف مسجل حضور بالفعل ولم يسجل الانصراف بعد";
  if (message.includes("Employee is not clocked in")) return "لا يوجد حضور مفتوح لهذا الموظف لتسجيل الانصراف";
  if (message.includes("Employee not found")) return "لم يتم العثور على حساب موظف نشط بهذا الاسم";
  if (message.includes("runtime variables")) return "الاتصال بقاعدة البيانات قيد التجهيز";
  return message;
}

async function loadAttendance() {
  const supabase = getSupabaseAdmin();
  const { start, end } = baghdadDayBounds();
  const activeSince = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const [presenceResult, sessionsResult, todayResult, tasksResult] = await Promise.all([
    supabase.from("employee_presence_overview").select("*").order("is_present", { ascending: false }).order("role").order("full_name"),
    supabase.from("employee_attendance_sessions").select("*").order("clock_in_at", { ascending: false }).limit(80),
    supabase.from("employee_attendance_sessions").select("id").gte("clock_in_at", start).lt("clock_in_at", end),
    supabase.from("operational_tasks").select("*").neq("status", "مكتملة").neq("status", "ملغاة").order("due_at", { ascending: true, nullsFirst: false }).limit(40),
  ]);
  const firstError = presenceResult.error || sessionsResult.error || todayResult.error || tasksResult.error;
  if (firstError) throw firstError;

  const presenceRows = (presenceResult.data || []) as Row[];
  const employeeIds = [...new Set([
    ...(sessionsResult.data || []).map((row) => Number(row.employee_id)),
    ...(tasksResult.data || []).map((row) => Number(row.assigned_employee_id)),
  ])].filter(Number.isFinite);
  const employeeMap = new Map<number, string>();
  if (employeeIds.length) {
    const { data, error } = await supabase.from("employees").select("id,full_name").in("id", employeeIds);
    if (error) throw error;
    for (const employee of data || []) employeeMap.set(Number(employee.id), String(employee.full_name));
  }

  const presence = presenceRows.map(camelize);
  return {
    summary: {
      present: presenceRows.filter((row) => Boolean(row.is_present)).length,
      total: presenceRows.length,
      arrivalsToday: (todayResult.data || []).length,
      activeLast15Minutes: presenceRows.filter((row) => String(row.last_activity_at || "") >= activeSince).length,
      openTasks: (tasksResult.data || []).length,
    },
    presence,
    sessions: ((sessionsResult.data || []) as Row[]).map((row) => ({
      ...camelize(row),
      employeeName: employeeMap.get(Number(row.employee_id)) || "موظف",
    })),
    tasks: ((tasksResult.data || []) as Row[]).map((row) => ({
      ...camelize(row),
      assigneeName: employeeMap.get(Number(row.assigned_employee_id)) || "موظف",
    })),
  };
}

export async function GET(request: Request) {
  try {
    const actorName = clean(new URL(request.url).searchParams.get("actorName"));
    await authorizeEmployeeRequest(request, actorName, ["رئيس المقيمين", "الإدارة العليا", "مطور النظام"]);
    return Response.json(await loadAttendance());
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationFailure(error, "تعذر تحميل سجل الحضور");
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Record<string, unknown>;
    const action = clean(payload.action);
    const employeeName = clean(payload.employeeName);
    const claimedActorName = clean(payload.actorName) || employeeName;
    if (!employeeName || !["clock_in", "clock_out"].includes(action)) {
      return Response.json({ error: "يرجى تحديد الموظف وعملية الحضور أو الانصراف" }, { status: 400 });
    }
    const actor = await authorizeEmployeeRequest(request, claimedActorName);
    if (!["رئيس المقيمين", "الإدارة العليا", "مطور النظام"].includes(actor.role) && actor.fullName !== employeeName) {
      throw new AuthorizationError("يمكن للموظف تسجيل حضوره فقط؛ التسجيل نيابة عن الآخرين من صلاحية الإدارة", 403);
    }

    const { error } = await getSupabaseAdmin().rpc("record_attendance_event", {
      p_employee_name: employeeName,
      p_action: action === "clock_in" ? "دخول" : "خروج",
      p_source: clean(payload.source) || "web",
      p_note: clean(payload.note) || null,
      p_recorded_by_name: actor.fullName,
    });
    if (error) throw error;
    return Response.json(await loadAttendance(), { status: action === "clock_in" ? 201 : 200 });
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationFailure(error, "تعذر تحديث سجل الحضور");
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
