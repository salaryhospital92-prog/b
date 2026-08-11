import { getSupabaseAdmin } from "../../../../lib/supabase-server";
import { currentUser } from "../../../../lib/session";

type Row = Record<string, unknown>;

const ISSUER_ROLES = ["رئيس المقيمين", "الإدارة العليا", "مطور النظام"];

// No look-alike characters: these get read aloud and typed by hand.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function generatePassword(length = 14) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

/** A short, typeable name derived from the employee number. */
function suggestLoginName(employeeNumber: string, fullName: string) {
  const digits = employeeNumber.replace(/\D/g, "").slice(-4);
  const latin = fullName.normalize("NFKD").replace(/[^A-Za-z]/g, "").toLowerCase().slice(0, 8);
  const stem = latin || employeeNumber.replace(/[^A-Za-z0-9]/g, "").toLowerCase().slice(0, 8) || "user";
  return digits ? `${stem}${digits}` : stem;
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** Looks an employee up by number so the issuer can confirm before generating. */
export async function GET(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user || !ISSUER_ROLES.includes(user.role)) {
      return Response.json({ error: "إصدار الحسابات متاح للإدارة ورئيس المقيمين فقط" }, { status: 403 });
    }
    const number = new URL(request.url).searchParams.get("employeeNumber")?.trim() || "";
    if (!number) return Response.json({ error: "أدخل رقم الموظف" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: employee, error } = await supabase.from("employees")
      .select("id,full_name,employee_number,role,specialty,status,approval_status")
      .ilike("employee_number", number).maybeSingle();
    if (error) throw error;
    if (!employee) return Response.json({ error: "لا يوجد موظف بهذا الرقم" }, { status: 404 });

    const { data: account } = await supabase.from("login_accounts")
      .select("login_name,last_login_at").eq("employee_id", employee.id).maybeSingle();

    return Response.json({
      employee,
      hasAccount: Boolean(account),
      loginName: account?.login_name || null,
      lastLoginAt: account?.last_login_at || null,
      active: employee.status === "نشط" && employee.approval_status === "معتمد",
    });
  } catch {
    return Response.json({ error: "تعذر البحث عن الموظف" }, { status: 500 });
  }
}

/** Issues (or re-issues) an account. The password is returned once and never stored in the clear. */
export async function POST(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user || !ISSUER_ROLES.includes(user.role)) {
      return Response.json({ error: "إصدار الحسابات متاح للإدارة ورئيس المقيمين فقط" }, { status: 403 });
    }

    const payload = (await request.json()) as Row;
    const employeeNumber = clean(payload.employeeNumber);
    if (!employeeNumber) return Response.json({ error: "أدخل رقم الموظف" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: employee } = await supabase.from("employees")
      .select("full_name,employee_number").ilike("employee_number", employeeNumber).maybeSingle();
    if (!employee) return Response.json({ error: "لا يوجد موظف بهذا الرقم" }, { status: 404 });

    const loginName = clean(payload.loginName) || suggestLoginName(String(employee.employee_number), String(employee.full_name));
    const password = generatePassword();

    const { data, error } = await supabase.rpc("provision_login", {
      p_employee_number: employeeNumber,
      p_login_name: loginName,
      p_password: password,
      p_actor_name: user.fullName,
      p_reissue: Boolean(payload.reissue),
    });
    if (error) throw error;

    const result = data as Row;
    if (result.error === "not_found") return Response.json({ error: "لا يوجد موظف بهذا الرقم" }, { status: 404 });
    if (result.error === "not_active") return Response.json({ error: "الموظف غير نشط أو غير معتمد بعد" }, { status: 409 });
    if (result.error === "name_taken") return Response.json({ error: "اسم المستخدم محجوز لموظف آخر. اختر اسمًا مختلفًا." }, { status: 409 });
    if (result.error === "exists") {
      return Response.json({
        error: `لهذا الموظف حساب بالفعل باسم «${result.login_name}». اختر إعادة الإصدار لإلغاء القديم وإنشاء كلمة مرور جديدة.`,
        hasAccount: true,
        loginName: result.login_name,
      }, { status: 409 });
    }

    return Response.json({
      ...result,
      password,
      message: result.reissued ? "تم إصدار كلمة مرور جديدة" : "تم إنشاء الحساب",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "تعذر إصدار الحساب" }, { status: 500 });
  }
}
