import { getSupabaseAdmin } from "../../../lib/supabase-server";

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
  const candidate = error as { message?: string };
  const message = candidate?.message || (error instanceof Error ? error.message : "تعذر تنفيذ تسليم المناوبة");
  if (message.includes("At least one patient") || message.includes("No active patients")) return "اختر مريضًا نشطًا واحدًا على الأقل";
  if (message.includes("Doctors must be different")) return "يجب اختيار طبيبين مختلفين للتسليم والاستلام";
  if (message.includes("Doctor names are required")) return "يرجى تحديد الطبيب المسلّم والطبيب المستلم";
  if (message.includes("Handover not found")) return "لم يتم العثور على سجل المناوبة";
  if (message.includes("runtime variables")) return "الاتصال بقاعدة البيانات قيد التجهيز";
  return message;
}

async function loadHandoverData() {
  const supabase = getSupabaseAdmin();
  const [handoverResult, candidatesResult] = await Promise.all([
    supabase.from("doctor_shift_handovers").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("patients").select("*").neq("patient_status", "خرجت").order("created_at", { ascending: false }).limit(50),
  ]);

  if (handoverResult.error) throw handoverResult.error;
  if (candidatesResult.error) throw candidatesResult.error;

  const handover = handoverResult.data as DbRecord | null;
  let handoverPatients: Array<Record<string, unknown>> = [];

  if (handover?.id) {
    const { data: itemRows, error: itemError } = await supabase
      .from("handover_patients")
      .select("*")
      .eq("handover_id", handover.id)
      .order("id", { ascending: true });
    if (itemError) throw itemError;

    const patientIds = (itemRows || []).map((item) => item.patient_id as number);
    const patientMap = new Map<number, DbRecord>();
    if (patientIds.length > 0) {
      const { data: patientRows, error: patientError } = await supabase.from("patients").select("*").in("id", patientIds);
      if (patientError) throw patientError;
      for (const patient of patientRows || []) patientMap.set(patient.id as number, patient as DbRecord);
    }

    handoverPatients = (itemRows || []).map((item) => ({
      ...camelizeRecord(item as DbRecord),
      patient: camelizeRecord(patientMap.get(item.patient_id as number) || null),
    }));
  }

  return {
    handover: handover ? { ...camelizeRecord(handover), patients: handoverPatients } : null,
    candidates: (candidatesResult.data || []).map((patient) => camelizeRecord(patient as DbRecord)),
  };
}

export async function GET() {
  try {
    return Response.json(await loadHandoverData());
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const action = clean(payload.action);
    const supabase = getSupabaseAdmin();

    if (action === "create") {
      const patientIds = Array.isArray(payload.patientIds)
        ? payload.patientIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
        : [];
      const { error } = await supabase.rpc("create_shift_handover", {
        p_from_doctor_name: clean(payload.fromDoctor),
        p_to_doctor_name: clean(payload.toDoctor),
        p_patient_ids: patientIds,
        p_notes: clean(payload.notes) || null,
      });
      if (error) throw error;
      return Response.json(await loadHandoverData(), { status: 201 });
    }

    if (action === "accept") {
      const handoverId = Number(payload.handoverId);
      if (!Number.isInteger(handoverId) || handoverId <= 0) {
        return Response.json({ error: "معرّف المناوبة غير صحيح" }, { status: 400 });
      }
      const { error } = await supabase.rpc("accept_shift_handover", { p_handover_id: handoverId });
      if (error) throw error;
      return Response.json(await loadHandoverData());
    }

    return Response.json({ error: "الإجراء المطلوب غير مدعوم" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
