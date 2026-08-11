import { getSupabaseAdmin, readRuntimeVariable } from "../../../../lib/supabase-server";
import { authorizationFailure, authorizeEmployeeRequest } from "../../../../lib/authorization";

export async function GET(request: Request) {
  try {
    const actorName = new URL(request.url).searchParams.get("actorName")?.trim() || "";
    await authorizeEmployeeRequest(request, actorName, ["رئيس المقيمين", "الإدارة العليا", "مطور النظام"]);
    const supabase = getSupabaseAdmin();
    const [accountsResult, updatesResult, tasksResult] = await Promise.all([
      supabase.from("telegram_accounts").select("id,employee_id,username,status,paired_at,last_seen_at").order("paired_at", { ascending: false }),
      supabase.from("telegram_updates").select("update_id,chat_id,employee_id,command,status,error_message,received_at,processed_at").order("received_at", { ascending: false }).limit(12),
      supabase.from("operational_tasks").select("id", { count: "exact", head: true }).neq("status", "مكتملة").neq("status", "ملغاة"),
    ]);
    const firstError = accountsResult.error || updatesResult.error || tasksResult.error;
    if (firstError) throw firstError;

    const employeeIds = (accountsResult.data || []).map((row) => Number(row.employee_id));
    const employeeMap = new Map<number, { name: string; role: string }>();
    if (employeeIds.length) {
      const { data, error } = await supabase.from("employees").select("id,full_name,role").in("id", employeeIds);
      if (error) throw error;
      for (const employee of data || []) employeeMap.set(Number(employee.id), { name: String(employee.full_name), role: String(employee.role) });
    }

    const tokenConfigured = Boolean(readRuntimeVariable("TELEGRAM_BOT_TOKEN"));
    const secretConfigured = Boolean(readRuntimeVariable("TELEGRAM_WEBHOOK_SECRET"));
    const publicUrlConfigured = Boolean(readRuntimeVariable("PUBLIC_APP_URL"));
    return Response.json({
      botUsername: readRuntimeVariable("TELEGRAM_BOT_USERNAME") || "Albayati_sysbot",
      configuration: {
        tokenConfigured,
        secretConfigured,
        publicUrlConfigured,
        webhookReady: tokenConfigured && secretConfigured && publicUrlConfigured,
      },
      linkedAccounts: (accountsResult.data || []).map((row) => ({
        id: row.id,
        employeeId: row.employee_id,
        employeeName: employeeMap.get(Number(row.employee_id))?.name || "موظف",
        employeeRole: employeeMap.get(Number(row.employee_id))?.role || "غير محدد",
        username: row.username,
        status: row.status,
        pairedAt: row.paired_at,
        lastSeenAt: row.last_seen_at,
      })),
      recentUpdates: (updatesResult.data || []).map((row) => ({
        updateId: row.update_id,
        employeeName: employeeMap.get(Number(row.employee_id))?.name || null,
        command: row.command,
        status: row.status,
        error: row.error_message,
        receivedAt: row.received_at,
        processedAt: row.processed_at,
      })),
      openTasks: tasksResult.count || 0,
    });
  } catch (error) {
    return authorizationFailure(error, "تعذر تحميل حالة بوت البياتي");
  }
}
