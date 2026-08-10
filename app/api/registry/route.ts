import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { buildNewbornNames, getBillingMode, getInitialPrice } from "../../../lib/rules-engine";

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
    const [patientResult, employeeResult] = await Promise.all([
      supabase.from("patients").select("*").eq("is_newborn", false).order("created_at", { ascending: false }).limit(12),
      supabase.from("employees").select("*").order("created_at", { ascending: false }).limit(12),
    ]);

    if (patientResult.error) throw patientResult.error;
    if (employeeResult.error) throw employeeResult.error;

    return Response.json({
      patients: (patientResult.data || []).map((row) => camelizeRecord(row as DbRecord)),
      employees: (employeeResult.data || []).map((row) => camelizeRecord(row as DbRecord)),
    });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const kind = clean(payload.kind);
    const supabase = getSupabaseAdmin();

    if (kind === "patient") {
      const fullName = clean(payload.fullName);
      const fileNumber = clean(payload.fileNumber);
      const admissionDate = clean(payload.admissionDate);
      const department = clean(payload.department);
      const gender = clean(payload.gender);
      const entryType = clean(payload.entryType) || "استشارية";
      const initialPrice = Math.max(0, Number(payload.initialPrice) || getInitialPrice(entryType));
      const newbornCount = Math.max(0, Math.min(5, Number(payload.newbornCount) || 0));

      if (!fullName || !fileNumber || !admissionDate || !department || !gender) {
        return Response.json({ error: "يرجى إكمال الحقول الأساسية للمريضة" }, { status: 400 });
      }

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
      return Response.json({
        record: camelizeRecord(result.record),
        newbornNames: result.newborn_names || newbornNames,
      }, { status: 201 });
    }

    if (kind === "employee") {
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
      return Response.json({ record: camelizeRecord(data as DbRecord) }, { status: 201 });
    }

    return Response.json({ error: "نوع السجل غير مدعوم" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const action = clean(payload.action);
    const patientId = Number(payload.patientId);

    if (!Number.isInteger(patientId) || patientId <= 0) {
      return Response.json({ error: "معرّف المريضة غير صحيح" }, { status: 400 });
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
    return Response.json({ patient: camelizeRecord(result.patient), message: result.message });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
