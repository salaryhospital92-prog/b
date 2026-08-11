import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin, readRuntimeVariable } from "../../../../lib/supabase-server";
import { hashToken, newSessionToken, readSessionCookie, sessionCookie, toUser } from "../../../../lib/session";

type Row = Record<string, unknown>;

/** Confirms the token really was issued by our Supabase project, and to whom. */
async function verifiedEmail(accessToken: string) {
  const url = readRuntimeVariable("SUPABASE_URL");
  const anonKey = readRuntimeVariable("SUPABASE_ANON_KEY");
  if (!url || !anonKey) throw new Error("auth not configured");
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user?.email) return null;
  // An unverified address proves nothing about who is holding it.
  if (data.user.email_confirmed_at || data.user.confirmed_at) return data.user.email.toLowerCase();
  return null;
}

/**
 * Signs in whoever proved control of an approved employee's address, whether
 * they came through Google, Apple, or an emailed link. Proving an address is
 * never enough on its own: the chief resident must already have approved that
 * employee, otherwise anyone with an email account could walk in.
 */
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Row;
    const accessToken = typeof payload.accessToken === "string" ? payload.accessToken : "";
    if (!accessToken) return Response.json({ error: "لم يصل إثبات الهوية" }, { status: 400 });

    const email = await verifiedEmail(accessToken);
    if (!email) return Response.json({ error: "تعذر التحقق من البريد الإلكتروني" }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const { data: employee, error } = await supabase.from("employees")
      .select("id,full_name,role,specialty,status,approval_status")
      .ilike("email", email).eq("status", "نشط").eq("approval_status", "معتمد").maybeSingle();
    if (error) throw error;
    if (!employee) {
      return Response.json({
        error: "هذا البريد غير مرتبط بحساب معتمد في النظام. أرسل طلب حساب ليعتمده رئيس المقيمين.",
        needsRequest: true,
        email,
      }, { status: 403 });
    }

    const token = newSessionToken();
    const { data: account } = await supabase.from("login_accounts").select("login_name").eq("employee_id", employee.id).maybeSingle();
    const { error: sessionError } = await supabase.from("app_sessions").insert({
      token_hash: await hashToken(token),
      employee_id: employee.id,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      user_agent: (request.headers.get("user-agent") || "").slice(0, 200),
    });
    if (sessionError) throw sessionError;

    return Response.json(
      { user: toUser({ ...employee, username: account?.login_name || email, must_change_password: false }) },
      { headers: { "Set-Cookie": sessionCookie(token, request), "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "تعذر تسجيل الدخول" }, { status: 500 });
  }
}

/**
 * Sets a new password after the owner proved control of the address. No current
 * password is asked for, because the emailed link already established identity.
 */
export async function PUT(request: Request) {
  try {
    const payload = (await request.json()) as Row;
    const accessToken = typeof payload.accessToken === "string" ? payload.accessToken : "";
    const newPassword = typeof payload.newPassword === "string" ? payload.newPassword : "";
    if (newPassword.length < 8) {
      return Response.json({ error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" }, { status: 400 });
    }

    const email = await verifiedEmail(accessToken);
    if (!email) return Response.json({ error: "انتهت صلاحية رابط الاستعادة. اطلب رابطًا جديدًا." }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const { data: employee, error } = await supabase.from("employees")
      .select("id,full_name").ilike("email", email).eq("status", "نشط").eq("approval_status", "معتمد").maybeSingle();
    if (error) throw error;
    if (!employee) return Response.json({ error: "هذا البريد غير مرتبط بحساب معتمد" }, { status: 403 });

    const { data: reset, error: resetError } = await supabase.rpc("reset_password", {
      p_employee_id: employee.id,
      p_new_password: newPassword,
      p_keep_token_hash: await hashToken(readSessionCookie(request)),
    });
    if (resetError) throw resetError;
    if (!reset) return Response.json({ error: "لا يوجد حساب دخول مرتبط بهذا الموظف" }, { status: 404 });

    return Response.json({ ok: true, message: "تم تعيين كلمة المرور. سجّل الدخول بها الآن." });
  } catch {
    return Response.json({ error: "تعذر تعيين كلمة المرور" }, { status: 500 });
  }
}
