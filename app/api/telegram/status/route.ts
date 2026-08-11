import { getSupabaseAdmin, readRuntimeVariable } from "../../../../lib/supabase-server";
import { authorizationFailure, authorizeEmployeeRequest } from "../../../../lib/authorization";

export async function GET(request: Request) {
  try {
    const actorName = new URL(request.url).searchParams.get("actorName")?.trim() || "";
    await authorizeEmployeeRequest(request, actorName, ["رئيس المقيمين", "الإدارة العليا", "مطور النظام"]);
    const supabase = getSupabaseAdmin();
    const [accountsResult, updatesResult, tasksResult, adminRequestsResult, allowlistResult] = await Promise.all([
      supabase.from("telegram_accounts").select("id,employee_id,username,status,is_bot_admin,paired_at,last_seen_at").order("paired_at", { ascending: false }),
      supabase.from("telegram_updates").select("update_id,chat_id,employee_id,command,status,error_message,received_at,processed_at").order("received_at", { ascending: false }).limit(12),
      supabase.from("operational_tasks").select("id", { count: "exact", head: true }).neq("status", "مكتملة").neq("status", "ملغاة"),
      supabase.from("telegram_bot_admin_requests").select("id,username,display_name,status,requested_at").order("requested_at", { ascending: false }).limit(20),
      supabase.from("telegram_bot_admin_allowlist").select("employee_id,telegram_username,phone_number,status,verified_at").limit(20),
    ]);
    const firstError = accountsResult.error || updatesResult.error || tasksResult.error || adminRequestsResult.error || allowlistResult.error;
    if (firstError) throw firstError;

    const employeeIds = [...new Set([
      ...(accountsResult.data || []).map((row) => Number(row.employee_id)),
      ...(allowlistResult.data || []).map((row) => Number(row.employee_id)),
    ])];
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
        isBotAdmin: Boolean(row.is_bot_admin),
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
      botAdmins: (accountsResult.data || []).filter((row) => Boolean(row.is_bot_admin)).map((row) => ({
        employeeName: employeeMap.get(Number(row.employee_id))?.name || "مدير بوت",
        username: row.username,
        lastSeenAt: row.last_seen_at,
      })),
      pendingAdminRequests: (adminRequestsResult.data || []).filter((row) => row.status === "بانتظار الموافقة").map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        requestedAt: row.requested_at,
      })),
      bootstrapAdmins: (allowlistResult.data || []).map((row) => ({
        employeeName: employeeMap.get(Number(row.employee_id))?.name || "د. مصطفى البياتي",
        username: row.telegram_username,
        phoneNumber: row.phone_number,
        status: row.status,
        verifiedAt: row.verified_at,
      })),
    });
  } catch (error) {
    return authorizationFailure(error, "تعذر تحميل حالة بوت البياتي");
  }
}
