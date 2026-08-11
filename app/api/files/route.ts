import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { AuthorizationError, authorizationFailure, authorizeEmployeeRequest } from "../../../lib/authorization";

type Row = Record<string, unknown>;

const BUCKETS: Record<string, { name: string; max: number; types: Set<string> }> = {
  patient: { name: "patient-files", max: 15 * 1024 * 1024, types: new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]) },
  employee: { name: "employee-files", max: 10 * 1024 * 1024, types: new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]) },
  report: { name: "system-exports", max: 25 * 1024 * 1024, types: new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv"]) },
};

function clean(value: FormDataEntryValue | string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function safeExtension(name: string, mimeType: string) {
  const fromName = name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromName) return fromName;
  return mimeType === "application/pdf" ? "pdf" : mimeType.includes("spreadsheet") ? "xlsx" : mimeType === "text/csv" ? "csv" : "jpg";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const entityType = clean(url.searchParams.get("entityType"));
    const entityId = clean(url.searchParams.get("entityId"));
    const actor = await authorizeEmployeeRequest(request, clean(url.searchParams.get("actorName")));
    if (!entityType || !entityId) return Response.json({ error: "نوع السجل ومعرّفه مطلوبان" }, { status: 400 });
    const isManager = ["رئيس المقيمين", "الإدارة العليا", "مطور النظام"].includes(actor.role);
    if (entityType === "employee" && entityId !== String(actor.id) && !isManager) {
      throw new AuthorizationError("لا يمكنك عرض مستندات موظف آخر", 403);
    }
    if (entityType === "report" && !["الحسابات", "رئيس المقيمين", "الإدارة العليا", "مطور النظام"].includes(actor.role)) {
      throw new AuthorizationError("لا تملك صلاحية عرض ملفات التقارير", 403);
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("file_attachments").select("*")
      .eq("entity_type", entityType).eq("entity_id", entityId).order("created_at", { ascending: false });
    if (error) throw error;
    const rows = (data || []) as Row[];
    const signedUrls = new Map<string, string>();
    for (const bucketName of [...new Set(rows.map((row) => String(row.bucket_name)))]) {
      const bucketRows = rows.filter((row) => row.bucket_name === bucketName);
      const { data: signed } = await supabase.storage.from(bucketName).createSignedUrls(bucketRows.map((row) => String(row.object_path)), 600);
      signed?.forEach((item, index) => item.signedUrl && signedUrls.set(`${bucketName}/${bucketRows[index].object_path}`, item.signedUrl));
    }
    return Response.json({ files: rows.map((row) => ({
      id: row.id,
      category: row.category,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      uploadedByName: row.uploaded_by_name,
      createdAt: row.created_at,
      signedUrl: signedUrls.get(`${row.bucket_name}/${row.object_path}`) || null,
    })) });
  } catch (error) {
    return authorizationFailure(error, "تعذر تحميل الملفات");
  }
}

export async function POST(request: Request) {
  let uploaded: { bucket: string; path: string } | null = null;
  try {
    const form = await request.formData();
    const entityType = clean(form.get("entityType"));
    const entityId = clean(form.get("entityId"));
    const category = clean(form.get("category"));
    const actorName = clean(form.get("actorName"));
    const actor = await authorizeEmployeeRequest(request, actorName);
    const file = form.get("file");
    const config = BUCKETS[entityType];
    if (!config || !entityId || !category || !(file instanceof File) || file.size === 0) {
      return Response.json({ error: "بيانات الملف أو السجل المرتبط غير مكتملة" }, { status: 400 });
    }
    const isManager = ["رئيس المقيمين", "الإدارة العليا", "مطور النظام"].includes(actor.role);
    if (entityType === "employee" && entityId !== String(actor.id) && !isManager) {
      throw new AuthorizationError("لا يمكنك إرفاق مستند لموظف آخر", 403);
    }
    if (entityType === "report" && !["الحسابات", "رئيس المقيمين", "الإدارة العليا", "مطور النظام"].includes(actor.role)) {
      throw new AuthorizationError("لا تملك صلاحية إرفاق ملفات التقارير", 403);
    }
    if (!config.types.has(file.type) || file.size > config.max) {
      return Response.json({ error: "نوع الملف غير مدعوم أو حجمه يتجاوز الحد المسموح" }, { status: 400 });
    }

    const now = new Date();
    const folder = `${entityType}/${entityId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const path = `${folder}/${crypto.randomUUID()}.${safeExtension(file.name, file.type)}`;
    const supabase = getSupabaseAdmin();
    const { error: uploadError } = await supabase.storage.from(config.name).upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    uploaded = { bucket: config.name, path };

    const { data, error } = await supabase.from("file_attachments").insert({
      bucket_name: config.name,
      object_path: path,
      entity_type: entityType,
      entity_id: entityId,
      category,
      original_filename: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      uploaded_by: actor.id,
      uploaded_by_name: actor.fullName,
      metadata: { uploadSource: "web" },
    }).select("*").single();
    if (error) throw error;
    const { data: signed } = await supabase.storage.from(config.name).createSignedUrl(path, 600);
    return Response.json({ file: { ...data, signedUrl: signed?.signedUrl || null } }, { status: 201 });
  } catch (error) {
    if (uploaded) {
      try { await getSupabaseAdmin().storage.from(uploaded.bucket).remove([uploaded.path]); } catch { /* best-effort cleanup */ }
    }
    return authorizationFailure(error, "تعذر حفظ الملف");
  }
}
