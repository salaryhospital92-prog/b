import { getSupabaseAdmin, readRuntimeVariable } from "../../../lib/supabase-server";

type DbRecord = Record<string, unknown>;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function camelize(row: DbRecord) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
    value,
  ]));
}

function demoReviewEnabled() {
  return readRuntimeVariable("DEMO_MODE") === "true";
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) return Response.json({ error: "يلزم تسجيل الدخول أولًا" }, { status: 401 });

    const payload = await request.json() as Record<string, unknown>;
    const supabase = getSupabaseAdmin();
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user?.email) {
      return Response.json({ error: "تعذر التحقق من هوية الحساب" }, { status: 401 });
    }

    const fullName = clean(payload.fullName) || clean(authData.user.user_metadata?.full_name) || authData.user.email.split("@")[0];
    const requestedRole = clean(payload.requestedRole);
    const specialty = clean(payload.specialty);
    const provider = String(authData.user.app_metadata?.provider || "email");
    const normalizedProvider = provider === "google" || provider === "apple" ? provider : "email";
    if (!requestedRole || !specialty) {
      return Response.json({ error: "يرجى تحديد الدور والاختصاص" }, { status: 400 });
    }

    const { data, error } = await supabase.from("system_access_requests").upsert({
      auth_user_id: authData.user.id,
      full_name: fullName,
      email: authData.user.email.toLowerCase(),
      provider: normalizedProvider,
      requested_role: requestedRole,
      specialty,
      status: "بانتظار الموافقة",
      reviewed_by: null,
      review_note: null,
      reviewed_at: null,
    }, { onConflict: "auth_user_id" }).select("*").single();
    if (error) throw error;

    return Response.json({ request: camelize(data as DbRecord) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر إرسال الطلب";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  if (!demoReviewEnabled()) {
    return Response.json({ error: "مراجعة الطلبات متاحة لمدير النظام فقط" }, { status: 403 });
  }
  try {
    const { data, error } = await getSupabaseAdmin().from("system_access_requests")
      .select("*").order("requested_at", { ascending: false }).limit(100);
    if (error) throw error;
    return Response.json({ requests: (data || []).map((row) => camelize(row as DbRecord)), demoMode: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "تعذر تحميل الطلبات" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!demoReviewEnabled()) {
    return Response.json({ error: "مراجعة الطلبات متاحة لمدير النظام فقط" }, { status: 403 });
  }
  try {
    const payload = await request.json() as Record<string, unknown>;
    const id = Number(payload.id);
    const decision = clean(payload.decision);
    if (!Number.isInteger(id) || id <= 0 || !["مقبول", "مرفوض"].includes(decision)) {
      return Response.json({ error: "قرار الموافقة غير صحيح" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: accessRequest, error: requestError } = await supabase.from("system_access_requests")
      .update({ status: decision, review_note: clean(payload.reviewNote) || null, reviewed_at: new Date().toISOString() })
      .eq("id", id).select("*").single();
    if (requestError) throw requestError;

    if (decision === "مقبول") {
      const row = accessRequest as DbRecord;
      const { data: existingEmployee, error: lookupError } = await supabase.from("employees")
        .select("id").or(`auth_user_id.eq.${row.auth_user_id},email.eq.${row.email}`).maybeSingle();
      if (lookupError) throw lookupError;
      if (existingEmployee) {
        const { error } = await supabase.from("employees").update({
          auth_user_id: row.auth_user_id,
          email: row.email,
          identity_provider: row.provider,
          approval_status: "معتمد",
          status: "نشط",
        }).eq("id", existingEmployee.id);
        if (error) throw error;
      } else {
        const baseUsername = String(row.email).split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "") || "user";
        const { error } = await supabase.from("employees").insert({
          auth_user_id: row.auth_user_id,
          email: row.email,
          identity_provider: row.provider,
          approval_status: "معتمد",
          full_name: row.full_name,
          employee_number: `REQ-${id}`,
          username: `${baseUsername}-${id}`,
          role: row.requested_role,
          specialty: row.specialty,
          join_date: new Date().toISOString().slice(0, 10),
          status: "نشط",
        });
        if (error) throw error;
      }
    }

    return Response.json({ request: camelize(accessRequest as DbRecord) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "تعذر حفظ القرار" }, { status: 500 });
  }
}
