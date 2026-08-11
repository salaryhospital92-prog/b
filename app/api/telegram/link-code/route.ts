import { getSupabaseAdmin } from "../../../../lib/supabase-server";
import { authorizationFailure, authorizeEmployeeRequest } from "../../../../lib/authorization";
import { createLinkCode } from "../../../../lib/telegram-link";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

    const { code, expiresAt, deepLink } = await createLinkCode(employeeId, actor.id);
    return Response.json({ code, employeeName: employee.full_name, expiresAt, deepLink }, { status: 201 });
  } catch (error) {
    return authorizationFailure(error, "تعذر إنشاء رمز الربط");
  }
}
