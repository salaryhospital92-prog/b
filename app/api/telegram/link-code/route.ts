import { getSupabaseAdmin, readRuntimeVariable } from "../../../../lib/supabase-server";
import { authorizationFailure, authorizeEmployeeRequest } from "../../../../lib/authorization";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function createCode() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Record<string, unknown>;
    const employeeId = Number(payload.employeeId);
    const actorName = clean(payload.actorName);
    if (!Number.isInteger(employeeId) || employeeId <= 0 || !actorName) {
      return Response.json({ error: "الموظف ومنشئ رمز الربط مطلوبان" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const [actor, { data: employee, error: employeeError }] = await Promise.all([
      authorizeEmployeeRequest(request, actorName, ["رئيس المقيمين", "الإدارة العليا", "مطور النظام"]),
      supabase.from("employees").select("id,full_name").eq("id", employeeId).eq("status", "نشط").maybeSingle(),
    ]);
    if (employeeError) throw employeeError;
    if (!employee) return Response.json({ error: "لم يتم العثور على الموظف" }, { status: 404 });

    await supabase.from("telegram_link_codes").delete().eq("employee_id", employeeId).is("used_at", null);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    let code = "";
    let insertError: unknown = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      code = createCode();
      const { error } = await supabase.from("telegram_link_codes").insert({
        code,
        employee_id: employeeId,
        created_by: actor.id,
        expires_at: expiresAt,
      });
      if (!error) { insertError = null; break; }
      insertError = error;
    }
    if (insertError) throw insertError;

    const botUsername = readRuntimeVariable("TELEGRAM_BOT_USERNAME") || "Albayati_sysbot";
    return Response.json({
      code,
      employeeName: employee.full_name,
      expiresAt,
      deepLink: `https://t.me/${botUsername}?start=${code}`,
    }, { status: 201 });
  } catch (error) {
    return authorizationFailure(error, "تعذر إنشاء رمز الربط");
  }
}
