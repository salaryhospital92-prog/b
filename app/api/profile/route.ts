import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { currentUser } from "../../../lib/session";
import { recordEmployeeActivitySafely } from "../../../lib/activity";

type Row = Record<string, unknown>;

const AVATAR_BUCKET = "employee-files";
const MAX_AVATAR = 2 * 1024 * 1024;
const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** The signed-in employee's own profile. */
export async function GET(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });

    const { data, error } = await getSupabaseAdmin().from("employees")
      .select("id,full_name,email,phone,role,specialty,avatar_path,employee_number,join_date")
      .eq("id", user.id).single();
    if (error) throw error;

    let avatarUrl: string | null = null;
    if (data.avatar_path) {
      const { data: signed } = await getSupabaseAdmin().storage.from(AVATAR_BUCKET)
        .createSignedUrl(String(data.avatar_path), 60 * 60);
      avatarUrl = signed?.signedUrl || null;
    }
    return Response.json({ profile: { ...data, avatarUrl, username: user.username } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "تعذر تحميل الملف الشخصي" }, { status: 500 });
  }
}

/** Updates the contact details an employee owns. Role and name stay with admin. */
export async function PATCH(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });

    const payload = (await request.json()) as Row;
    const email = clean(payload.email);
    const phone = clean(payload.phone);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "صيغة البريد الإلكتروني غير صحيحة" }, { status: 400 });
    }

    const { data, error } = await getSupabaseAdmin().from("employees")
      .update({ email: email || null, phone: phone || null })
      .eq("id", user.id).select("id,full_name,email,phone").single();
    if (error) throw error;

    await recordEmployeeActivitySafely({
      employeeName: user.fullName,
      activityType: "تحديث الملف الشخصي",
      description: "حدّث بيانات التواصل الخاصة به",
      entityType: "employee",
      entityId: user.id,
      source: "web",
    });
    return Response.json({ profile: data, message: "تم حفظ بياناتك" });
  } catch {
    return Response.json({ error: "تعذر حفظ البيانات" }, { status: 500 });
  }
}

/** Replaces the employee's own photo. */
export async function POST(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });

    const form = await request.formData();
    const file = form.get("avatar");
    if (!(file instanceof File)) return Response.json({ error: "لم تصل صورة" }, { status: 400 });
    if (!AVATAR_TYPES.has(file.type)) return Response.json({ error: "الصور المدعومة: JPG أو PNG أو WEBP" }, { status: 400 });
    if (file.size > MAX_AVATAR) return Response.json({ error: "حجم الصورة يتجاوز 2MB" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const objectPath = `avatars/${user.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET)
      .upload(objectPath, await file.arrayBuffer(), { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;

    // Drop the previous photo so old files do not pile up in the bucket.
    const { data: existing } = await supabase.from("employees").select("avatar_path").eq("id", user.id).single();
    if (existing?.avatar_path) {
      await supabase.storage.from(AVATAR_BUCKET).remove([String(existing.avatar_path)]);
    }
    const { error } = await supabase.from("employees").update({ avatar_path: objectPath }).eq("id", user.id);
    if (error) throw error;

    const { data: signed } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(objectPath, 60 * 60);
    await recordEmployeeActivitySafely({
      employeeName: user.fullName,
      activityType: "تحديث الصورة الشخصية",
      description: "رفع صورة شخصية جديدة",
      entityType: "employee",
      entityId: user.id,
      source: "web",
    });
    return Response.json({ avatarUrl: signed?.signedUrl || null, message: "تم تحديث صورتك" });
  } catch {
    return Response.json({ error: "تعذر رفع الصورة" }, { status: 500 });
  }
}
