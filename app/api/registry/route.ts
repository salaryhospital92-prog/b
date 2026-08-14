import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { buildNewbornNames, getBillingMode, getInitialPrice, isBirthEntry, MAX_NEWBORNS, parseNewbornCount } from "../../../lib/rules-engine";
import { recordEmployeeActivitySafely } from "../../../lib/activity";
import { authorizationFailure, authorizeEmployeeRequest } from "../../../lib/authorization";

// Registering a patient is the accounts desk's job; creating staff is the chief's.
const PATIENT_ROLES = ["الحسابات", "رئيس المقيمين", "الإدارة العليا", "مطور النظام"];
const STAFF_ROLES = ["رئيس المقيمين", "مطور النظام"];

type DbRecord = Record<string, unknown>;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function camelizeRecord(row: DbRecord | null) {
  if (!row) return null;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]),
  );
}

function errorMessage(error: unknown) {
  const candidate = error as { code?: string; message?: string };
  const message = candidate?.message || (error instanceof Error ? error.message : "تعذر حفظ السجل");
  if (candidate?.code === "23505" || message.includes("duplicate key value")) {
    return "رقم الملف أو رقم الموظف أو اسم المستخدم مسجل مسبقًا";
  }
  if (message.includes("runtime variables")) return "الاتصال بقاعدة البيانات قيد التجهيز";
  if (message.includes("Patient not found")) return "لم يتم العثور على سجل المريضة";
  return message;
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const [patientResult, employeeResult, readmissionResult] = await Promise.all([
      supabase.from("patients").select("*").eq("is_newborn", false).order("created_at", { ascending: false }).limit(12),
      supabase.from("employees").select("*").order("created_at", { ascending: false }).limit(12),
      supabase.from("newborn_readmission_candidates").select("*").order("discharge_date", { ascending: false }).limit(60),
    ]);

    if (patientResult.error) throw patientResult.error;
    if (employeeResult.error) throw employeeResult.error;
    if (readmissionResult.error) throw readmissionResult.error;

    return Response.json({
      patients: (patientResult.data || []).map((row) => camelizeRecord(row as DbRecord)),
      employees: (employeeResult.data || []).map((row) => camelizeRecord(row as DbRecord)),
      readmissionCandidates: (readmissionResult.data || []).map((row) => camelizeRecord(row as DbRecord)),
    });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const kind = clean(payload.kind);
    const actorName = clean(payload.actorName);
    const supabase = getSupabaseAdmin();

    if (kind === "patient") {
      await authorizeEmployeeRequest(request, actorName, PATIENT_ROLES);
      const fullName = clean(payload.fullName);
      const fileNumber = clean(payload.fileNumber);
      const admissionDate = clean(payload.admissionDate);
      const department = clean(payload.department);
      const entryType = clean(payload.entryType) || "استشارية";
      // A birth is recorded on the mother's file, so the form never asks for gender there.
      const gender = isBirthEntry(entryType) ? "أنثى" : clean(payload.gender);
      const initialPrice = Math.max(0, Number(payload.initialPrice) || getInitialPrice(entryType));
      const requestedNewborns = isBirthEntry(entryType) ? parseNewbornCount(payload.newbornCount) : 0;

      if (!fullName || !fileNumber || !admissionDate || !department || !gender) {
        return Response.json({ error: "يرجى إكمال الحقول الأساسية للمريضة" }, { status: 400 });
      }
      if (requestedNewborns === null) {
        return Response.json({ error: `عدد المواليد يجب أن يكون رقمًا بين 0 و${MAX_NEWBORNS}` }, { status: 400 });
      }
      const newbornCount = requestedNewborns;

      const newbornNames = buildNewbornNames(fullName, newbornCount);
      const { data, error } = await supabase.rpc("register_patient", {
        p_full_name: fullName,
        p_file_number: fileNumber,
        p_birth_date: clean(payload.birthDate) || null,
        p_gender: gender,
        p_phone: clean(payload.phone),
        p_admission_date: admissionDate,
        p_department: department,
        p_attending_doctor: clean(payload.attendingDoctor),
        p_payment_category: clean(payload.paymentCategory) || "نقدي",
        p_entry_type: entryType,
        p_billing_mode: getBillingMode(entryType),
        p_notes: clean(payload.notes),
        p_initial_price: initialPrice,
        p_newborn_names: newbornNames,
      });

      if (error) throw error;
      const result = data as { record: DbRecord; newborn_names: string[] };
      await recordEmployeeActivitySafely({
        employeeName: actorName,
        activityType: "تسجيل مريض",
        description: `أنشأ ملف المريض ${fullName}`,
        entityType: "patient",
        entityId: String(result.record.id),
        source: "web",
        metadata: { fileNumber, entryType },
      });
      return Response.json({
        record: camelizeRecord(result.record),
        newbornNames: result.newborn_names || newbornNames,
      }, { status: 201 });
    }

    if (kind === "employee") {
      await authorizeEmployeeRequest(request, actorName, STAFF_ROLES);
      const fullName = clean(payload.fullName);
      const employeeNumber = clean(payload.employeeNumber);
      const username = clean(payload.username);
      const role = clean(payload.role);
      const specialty = clean(payload.specialty);
      const joinDate = clean(payload.joinDate);

      if (!fullName || !employeeNumber || !username || !role || !specialty || !joinDate) {
        return Response.json({ error: "يرجى إكمال الحقول الأساسية للموظف" }, { status: 400 });
      }

      const { data, error } = await supabase.from("employees").insert({
        full_name: fullName,
        employee_number: employeeNumber,
        username,
        phone: clean(payload.phone) || null,
        role,
        specialty,
        join_date: joinDate,
        max_consultations: clean(payload.maxConsultations) ? Number(payload.maxConsultations) : null,
        daily_cap: clean(payload.dailyCap) ? Number(payload.dailyCap) : null,
        status: clean(payload.status) || "نشط",
      }).select("*").single();

      if (error) throw error;
      await recordEmployeeActivitySafely({
        employeeName: actorName,
        activityType: "تسجيل موظف",
        description: `أنشأ حساب الموظف ${fullName}`,
        entityType: "employee",
        entityId: String(data.id),
        source: "web",
        metadata: { employeeNumber, role, specialty },
      });
      return Response.json({ record: camelizeRecord(data as DbRecord) }, { status: 201 });
    }

    return Response.json({ error: "نوع السجل غير مدعوم" }, { status: 400 });
  } catch (error) {
    return authorizationFailure(error, errorMessage(error));
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const action = clean(payload.action);
    const actorName = clean(payload.actorName);
    await authorizeEmployeeRequest(request, actorName, PATIENT_ROLES);
    const patientId = Number(payload.patientId);

    if (!Number.isInteger(patientId) || patientId <= 0) {
      return Response.json({ error: "معرّف المريضة غير صحيح" }, { status: 400 });
    }

    // A newborn returning after discharge reopens the record already tied to the
    // mother's file — no second registration, no duplicate patient.
    if (action === "readmit_newborn") {
      const { data, error } = await getSupabaseAdmin().rpc("readmit_newborn", {
        p_newborn_id: patientId,
        p_department: clean(payload.department),
        p_attending_doctor: clean(payload.attendingDoctor),
        p_notes: clean(payload.notes),
        p_recorded_by: actorName,
      });
      if (error) {
        if (String(error.message).includes("already admitted")) {
          return Response.json({ error: "هذا المولود مسجل حاليًا كنشط — لا حاجة لإعادة الدخول" }, { status: 409 });
        }
        throw error;
      }
      const result = data as { record: DbRecord; mother: DbRecord };
      const message = `أُعيد فتح ملف ${result.record.full_name} المرتبط بملف الأم ${result.mother.full_name}`;
      await recordEmployeeActivitySafely({
        employeeName: actorName,
        activityType: "إعادة دخول مولود",
        description: message,
        entityType: "patient",
        entityId: patientId,
        source: "web",
        metadata: { motherId: result.mother.id, motherFileNumber: result.mother.file_number },
      });
      return Response.json({ patient: camelizeRecord(result.record), mother: camelizeRecord(result.mother), message });
    }

    if (action !== "convert_to_inpatient" && action !== "discharge") {
      return Response.json({ error: "الانتقال المطلوب غير مدعوم" }, { status: 400 });
    }

    const { data, error } = await getSupabaseAdmin().rpc("transition_patient_lifecycle", {
      p_patient_id: patientId,
      p_action: action,
    });

    if (error) throw error;
    const result = data as { patient: DbRecord; message: string };
    await recordEmployeeActivitySafely({
      employeeName: actorName,
      activityType: action === "discharge" ? "خروج مريض" : "تحويل إلى رقود",
      description: result.message,
      entityType: "patient",
      entityId: patientId,
      source: "web",
    });
    return Response.json({ patient: camelizeRecord(result.patient), message: result.message });
  } catch (error) {
    return authorizationFailure(error, errorMessage(error));
  }
}
