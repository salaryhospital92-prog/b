import { getSupabaseAdmin, readRuntimeVariable } from "./supabase-server";

export type AuthorizedEmployee = { id: number; fullName: string; role: string; specialty: string };

export class AuthorizationError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function authorizeEmployeeRequest(request: Request, claimedName: string, allowedRoles?: string[]): Promise<AuthorizedEmployee> {
  const supabase = getSupabaseAdmin();
  let query = supabase.from("employees").select("id,full_name,role,specialty,status,approval_status");

  if (readRuntimeVariable("DEMO_MODE") === "true") {
    if (!claimedName.trim()) throw new AuthorizationError("يلزم تحديد الحساب التجريبي", 401);
    query = query.eq("full_name", claimedName.trim());
  } else {
    const authorization = request.headers.get("authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) throw new AuthorizationError("يلزم تسجيل الدخول إلى النظام", 401);
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) throw new AuthorizationError("تعذر التحقق من هوية المستخدم", 401);
    query = query.eq("auth_user_id", authData.user.id);
  }

  const { data, error } = await query.eq("status", "نشط").eq("approval_status", "معتمد").limit(1).maybeSingle();
  if (error) throw error;
  if (!data) throw new AuthorizationError("الحساب غير نشط أو لم تتم الموافقة عليه", 403);
  if (allowedRoles?.length && !allowedRoles.includes(String(data.role))) {
    throw new AuthorizationError("لا تملك الصلاحية المطلوبة لهذه العملية", 403);
  }
  return {
    id: Number(data.id),
    fullName: String(data.full_name),
    role: String(data.role),
    specialty: String(data.specialty),
  };
}

export function authorizationFailure(error: unknown, fallback: string) {
  if (error instanceof AuthorizationError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
