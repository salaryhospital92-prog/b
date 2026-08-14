import { getSupabaseAdmin, readRuntimeVariable } from "../../../lib/supabase-server";

type Row = Record<string, unknown>;

const BUCKET = "consultation-evidence";
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);
// Phone photos routinely pass 5MB, and the old ceiling rejected them outright.
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Some phone pickers hand over an empty or generic MIME type — iOS does it for
 * HEIC constantly — so the extension is the fallback rather than a rejection.
 */
function imageKind(file: File) {
  if (ALLOWED_TYPES.has(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!ALLOWED_EXTENSIONS.has(extension)) return null;
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "heic" || extension === "heif") return `image/${extension}`;
  return "image/jpeg";
}

function demoEnabled() {
  return readRuntimeVariable("DEMO_MODE") === "true";
}

function clean(value: FormDataEntryValue | string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function integer(value: FormDataEntryValue | string | null | undefined) {
  const parsed = Number(clean(value));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : -1;
}

function safeFileName(name: string) {
  const extension = name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return `${crypto.randomUUID()}.${extension}`;
}

function recordValue(row: Row, key: string) {
  const value = row[key];
  return typeof value === "number" ? value : Number(value || 0);
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return fallback;
}

export async function GET(request: Request) {
  if (!demoEnabled()) return Response.json({ error: "يلزم تسجيل الدخول إلى النظام" }, { status: 403 });
  try {
    const supabase = getSupabaseAdmin();
    const doctorName = clean(new URL(request.url).searchParams.get("doctorName"));
    let doctorId: number | null = null;
    if (doctorName) {
      const { data: doctor, error } = await supabase.from("employees").select("id")
        .eq("full_name", doctorName).eq("role", "طبيب مقيم").maybeSingle();
      if (error) throw error;
      doctorId = doctor ? Number(doctor.id) : -1;
    }

    let callsQuery = supabase.from("doctor_calls").select("*")
      .order("call_date", { ascending: false }).order("updated_at", { ascending: false }).limit(100);
    if (doctorId !== null) callsQuery = callsQuery.eq("doctor_id", doctorId);
    const { data: calls, error: callsError } = await callsQuery;
    if (callsError) throw callsError;
    const callRows = (calls || []) as Row[];
    if (!callRows.length) return Response.json({ logs: [] });

    const callIds = callRows.map((row) => Number(row.id));
    const doctorIds = [...new Set(callRows.map((row) => Number(row.doctor_id)))];
    const [{ data: doctors, error: doctorsError }, { data: revisions, error: revisionsError }, { data: deliveries, error: deliveriesError }, { data: consultations, error: consultationsError }, { data: objections, error: objectionsError }] = await Promise.all([
      supabase.from("employees").select("id,full_name").in("id", doctorIds),
      supabase.from("doctor_call_revisions").select("*").in("call_id", callIds).order("created_at", { ascending: false }),
      supabase.from("doctor_call_deliveries").select("*").in("call_id", callIds).order("sent_at", { ascending: false }),
      supabase.from("doctor_call_consultations").select("*").in("call_id", callIds).order("case_number", { ascending: true }),
      supabase.from("doctor_call_objections").select("*").in("call_id", callIds).order("submitted_at", { ascending: false }),
    ]);
    const firstError = doctorsError || revisionsError || deliveriesError || consultationsError || objectionsError;
    if (firstError) throw firstError;

    const doctorMap = new Map((doctors || []).map((row) => [Number(row.id), String(row.full_name)]));
    const consultationRows = (consultations || []) as Row[];
    const paths = consultationRows.map((row) => String(row.evidence_path));
    const signedMap = new Map<string, string>();
    if (paths.length) {
      const { data: signed, error: signedError } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 600);
      if (!signedError) signed?.forEach((item, index) => item.signedUrl && signedMap.set(paths[index], item.signedUrl));
    }

    const byCall = <T extends Row>(rows: T[] | null, key: string) => {
      const map = new Map<number, T[]>();
      (rows || []).forEach((row) => {
        const id = Number(row[key]);
        map.set(id, [...(map.get(id) || []), row]);
      });
      return map;
    };
    const revisionMap = byCall(revisions as Row[] | null, "call_id");
    const deliveryMap = byCall(deliveries as Row[] | null, "call_id");
    const consultationMap = byCall(consultationRows, "call_id");
    const objectionMap = byCall(objections as Row[] | null, "call_id");

    const logs = callRows.map((row) => {
      const id = Number(row.id);
      return {
        id,
        doctorId: Number(row.doctor_id),
        doctorName: doctorMap.get(Number(row.doctor_id)) || "طبيب مقيم",
        callDate: row.call_date,
        callHours: recordValue(row, "call_hours"),
        inpatients: recordValue(row, "inpatient_count"),
        consultations: recordValue(row, "consultation_count"),
        births: recordValue(row, "natural_birth_count"),
        cesareans: recordValue(row, "cesarean_count"),
        specialCases: recordValue(row, "special_cases_count"),
        specialNote: row.special_cases_note,
        status: row.status,
        totalCalculated: recordValue(row, "total_calculated"),
        totalApproved: recordValue(row, "total_approved"),
        lastEditorName: row.last_edited_by_name,
        updatedAt: row.updated_at,
        evidence: (consultationMap.get(id) || []).map((item) => ({
          id: Number(item.id), caseNumber: Number(item.case_number), caseLabel: item.case_label,
          signedUrl: signedMap.get(String(item.evidence_path)) || null,
        })),
        revisions: (revisionMap.get(id) || []).map((item) => ({
          id: Number(item.id), editorName: item.editor_name, action: item.action,
          financialDelta: recordValue(item, "financial_delta"), note: item.note,
          beforeData: item.before_data, afterData: item.after_data, createdAt: item.created_at,
        })),
        deliveries: (deliveryMap.get(id) || []).map((item) => ({
          recipientRole: item.recipient_role, status: item.status, sentAt: item.sent_at,
        })),
        objections: (objectionMap.get(id) || []).map((item) => ({
          id: Number(item.id), reason: item.reason, disputedAmount: recordValue(item, "disputed_amount"),
          status: item.status, reviewerName: item.reviewer_name, responseNote: item.response_note,
          adjustmentAmount: recordValue(item, "adjustment_amount"), submittedAt: item.submitted_at,
          resolvedAt: item.resolved_at,
        })),
      };
    });
    return Response.json({ logs });
  } catch (error) {
    return Response.json({ error: errorMessage(error, "تعذر تحميل سجلات المناوبات") }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!demoEnabled()) return Response.json({ error: "يلزم تسجيل الدخول إلى النظام" }, { status: 403 });
  const uploadedPaths: string[] = [];
  try {
    const form = await request.formData();
    const doctorName = clean(form.get("doctorName"));
    const editorName = clean(form.get("editorName"));
    const callDate = clean(form.get("callDate"));
    const callHours = integer(form.get("callHours"));
    const inpatients = integer(form.get("inpatients"));
    const consultations = integer(form.get("consultations"));
    const births = integer(form.get("births"));
    const cesareans = integer(form.get("cesareans"));
    const specialCases = integer(form.get("specialCases"));
    const specialNote = clean(form.get("specialNote"));
    const labels = form.getAll("consultationLabel").map(clean);
    // Slots keep their position, so replacing one photo out of three is possible
    // instead of forcing every image to be re-picked.
    const evidenceSlots = form.getAll("consultationEvidence")
      .map((item) => (item instanceof File && item.size > 0 ? item : null));
    const files = evidenceSlots.filter((item): item is File => item !== null);

    if (!doctorName || !editorName || !/^\d{4}-\d{2}-\d{2}$/.test(callDate) || ![12, 24].includes(callHours)) {
      return Response.json({ error: "بيانات الطبيب أو تاريخ وساعات الكول غير مكتملة" }, { status: 400 });
    }
    if ([inpatients, consultations, births, cesareans, specialCases].some((value) => value < 0)) {
      return Response.json({ error: "يرجى إدخال أعداد صحيحة للحالات" }, { status: 400 });
    }
    for (const file of files) {
      if (!imageKind(file)) {
        return Response.json({ error: "صور الإثبات يجب أن تكون JPG أو PNG أو WEBP أو HEIC" }, { status: 400 });
      }
      if (file.size > MAX_FILE_SIZE) {
        return Response.json({ error: `حجم «${file.name}» يتجاوز 10MB. صغّر الصورة وأعد المحاولة.` }, { status: 400 });
      }
    }

    const supabase = getSupabaseAdmin();
    const { data: doctor, error: doctorError } = await supabase.from("employees")
      .select("id").eq("full_name", doctorName).eq("role", "طبيب مقيم").maybeSingle();
    if (doctorError) throw doctorError;
    if (!doctor) return Response.json({ error: "حساب الطبيب المقيم غير موجود" }, { status: 404 });

    const { data: oldCall, error: oldCallError } = await supabase.from("doctor_calls")
      .select("id").eq("doctor_id", doctor.id).eq("call_date", callDate).maybeSingle();
    if (oldCallError) throw oldCallError;
    let oldEvidence: { evidence_path: string; case_label: string | null }[] = [];
    if (oldCall) {
      const { data, error } = await supabase.from("doctor_call_consultations")
        .select("evidence_path,case_label").eq("call_id", oldCall.id).order("case_number", { ascending: true });
      if (error) throw error;
      oldEvidence = (data || []).map((row) => ({ evidence_path: String(row.evidence_path), case_label: row.case_label }));
    }

    // Each case keeps whichever photo it already had unless a new one was picked
    // for that exact slot, so a single replacement no longer forces the rest.
    const missing: number[] = [];
    for (let index = 0; index < consultations; index += 1) {
      if (!evidenceSlots[index] && !oldEvidence[index]) missing.push(index + 1);
    }
    if (missing.length) {
      return Response.json({
        error: missing.length === consultations
          ? `يلزم إرفاق ${consultations} صورة؛ صورة واحدة لكل استشارية`
          : `ينقص إثبات الحالة رقم ${missing.join("، ")}`,
      }, { status: 400 });
    }

    const folder = `${doctor.id}/${callDate}`;
    const freshPaths = new Map<number, string>();
    for (let index = 0; index < consultations; index += 1) {
      const file = evidenceSlots[index];
      if (!file) continue;
      const path = `${folder}/${safeFileName(file.name)}`;
      const { error } = await supabase.storage.from(BUCKET)
        .upload(path, file, { contentType: imageKind(file) || "image/jpeg", upsert: false });
      if (error) throw error;
      uploadedPaths.push(path);
      freshPaths.set(index, path);
    }

    const evidence = Array.from({ length: consultations }, (_, index) => ({
      caseNumber: index + 1,
      caseLabel: labels[index] || oldEvidence[index]?.case_label || `الحالة الاستشارية ${index + 1}`,
      path: freshPaths.get(index) ?? oldEvidence[index].evidence_path,
    }));
    const { data, error } = await supabase.rpc("save_resident_work_log", {
      p_doctor_name: doctorName,
      p_editor_name: editorName,
      p_call_date: callDate,
      p_call_hours: callHours,
      p_inpatient_count: inpatients,
      p_consultation_count: consultations,
      p_birth_count: births,
      p_cesarean_count: cesareans,
      p_special_count: specialCases,
      p_special_note: specialNote,
      p_evidence: evidence,
    });
    if (error) throw error;
    if (uploadedPaths.length && oldEvidence.length) await supabase.storage.from(BUCKET).remove(oldEvidence.map((item) => item.evidence_path));
    return Response.json({ log: data }, { status: oldCall ? 200 : 201 });
  } catch (error) {
    if (uploadedPaths.length) {
      try { await getSupabaseAdmin().storage.from(BUCKET).remove(uploadedPaths); } catch { /* best-effort cleanup */ }
    }
    return Response.json({ error: errorMessage(error, "تعذر حفظ سجل المناوبة") }, { status: 500 });
  }
}
