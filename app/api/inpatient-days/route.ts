import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { authorizationFailure, authorizeEmployeeRequest } from "../../../lib/authorization";
import { recordEmployeeActivitySafely } from "../../../lib/activity";
import { DAY_PAYMENT_STATES, INPATIENT_DAY_FEE, type DayPaymentState } from "../../../lib/rules-engine";

type Row = Record<string, unknown>;

const BILLING_ROLES = ["الحسابات", "رئيس المقيمين", "الإدارة العليا", "مطور النظام"];

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(new Date());
}

/** Inclusive list of ISO days between two dates, capped so a long stay cannot blow up the payload. */
function dayRange(from: string, to: string, cap = 120) {
  const days: string[] = [];
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (let cursor = new Date(`${from}T00:00:00Z`).getTime(); cursor <= end && days.length < cap; cursor += 86_400_000) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return days;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const actor = await authorizeEmployeeRequest(request, url.searchParams.get("actorName")?.trim() || "");
    const to = url.searchParams.get("to") || today();
    const from = url.searchParams.get("from") || new Date(new Date(`${to}T00:00:00Z`).getTime() - 13 * 86_400_000).toISOString().slice(0, 10);
    const supabase = getSupabaseAdmin();

    const [{ data: stays, error: staysError }, { data: ledger, error: ledgerError }, { data: totals, error: totalsError }] = await Promise.all([
      // Anyone still admitted, plus anyone discharged inside the window.
      supabase.from("patients")
        .select("id,full_name,file_number,department,admission_date,discharge_date,patient_status,attending_doctor,is_newborn,is_premature,incubator_note,mother_id")
        .or(`patient_status.neq.خرجت,discharge_date.gte.${from}`)
        .order("admission_date", { ascending: true }).limit(200),
      supabase.from("inpatient_day_ledger").select("*").gte("record_date", from).lte("record_date", to),
      supabase.from("doctor_inpatient_totals").select("*"),
    ]);
    if (staysError) throw staysError;
    if (ledgerError) throw ledgerError;
    if (totalsError) throw totalsError;

    const mothers = new Map(((stays || []) as Row[]).map((row) => [Number(row.id), String(row.full_name)]));
    const byPatient = new Map<number, Row[]>();
    for (const row of (ledger || []) as Row[]) {
      byPatient.set(Number(row.patient_id), [...(byPatient.get(Number(row.patient_id)) || []), row]);
    }

    const days = dayRange(from, to);
    const patients = ((stays || []) as Row[]).map((row) => {
      const rows = byPatient.get(Number(row.id)) || [];
      const statuses = new Map(rows.map((entry) => [String(entry.record_date), String(entry.payment_status) as DayPaymentState]));
      return {
        id: Number(row.id),
        fullName: String(row.full_name),
        fileNumber: String(row.file_number),
        department: String(row.department),
        admissionDate: String(row.admission_date),
        dischargeDate: row.discharge_date ? String(row.discharge_date) : null,
        patientStatus: String(row.patient_status),
        attendingDoctor: row.attending_doctor ? String(row.attending_doctor) : null,
        isNewborn: Boolean(row.is_newborn),
        isPremature: Boolean(row.is_premature),
        incubatorNote: row.incubator_note ? String(row.incubator_note) : null,
        motherName: row.mother_id ? mothers.get(Number(row.mother_id)) || null : null,
        // A day before admission or after discharge is not billable at all.
        days: days.map((day) => ({
          date: day,
          billable: day >= String(row.admission_date) && (!row.discharge_date || day <= String(row.discharge_date)),
          status: statuses.get(day) || null,
        })),
        stayDays: Math.max(1, Math.round((new Date(`${row.discharge_date || today()}T00:00:00Z`).getTime() - new Date(`${row.admission_date}T00:00:00Z`).getTime()) / 86_400_000) + 1),
      };
    });

    const mine = ((totals || []) as Row[]).find((row) => String(row.doctor_name) === actor.fullName) || null;
    return Response.json({
      range: { from, to, days },
      dayFee: INPATIENT_DAY_FEE,
      states: DAY_PAYMENT_STATES,
      canEdit: BILLING_ROLES.includes(actor.role),
      patients,
      premature: patients.filter((patient) => patient.isPremature),
      doctorTotals: totals || [],
      myTotals: mine ? {
        paidDays: Number(mine.paid_days), pendingDays: Number(mine.pending_days), freeDays: Number(mine.free_days),
        paidTotal: Number(mine.paid_total), pendingTotal: Number(mine.pending_total),
      } : { paidDays: 0, pendingDays: 0, freeDays: 0, paidTotal: 0, pendingTotal: 0 },
    });
  } catch (error) {
    return authorizationFailure(error, "تعذر تحميل أيام الرقود");
  }
}

/** Set one day's payment state. Totals recompute from the ledger, so history stays correct. */
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Row;
    const actor = await authorizeEmployeeRequest(request, clean(payload.actorName), BILLING_ROLES);
    const patientId = Number(payload.patientId);
    const recordDate = clean(payload.recordDate);
    const status = clean(payload.status) as DayPaymentState;

    if (!Number.isInteger(patientId) || patientId <= 0) return Response.json({ error: "معرّف المريضة غير صحيح" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDate)) return Response.json({ error: "التاريخ غير صحيح" }, { status: 400 });
    if (!DAY_PAYMENT_STATES.includes(status)) return Response.json({ error: "حالة الدفع غير مدعومة" }, { status: 400 });

    const { data, error } = await getSupabaseAdmin().rpc("set_inpatient_day", {
      p_patient_id: patientId,
      p_record_date: recordDate,
      p_status: status,
      p_doctor_name: clean(payload.doctorName) || null,
      p_actor_name: actor.fullName,
      p_note: clean(payload.note) || null,
    });
    if (error) {
      if (String(error.message).includes("day precedes admission")) {
        return Response.json({ error: "لا يمكن تسجيل يوم قبل تاريخ الدخول" }, { status: 400 });
      }
      throw error;
    }

    const result = data as { patient_name?: string; totals?: Row[] };
    await recordEmployeeActivitySafely({
      employeeName: actor.fullName,
      activityType: "تحديث حالة دفع يوم رقود",
      description: `ضبط يوم ${recordDate} للمريضة ${result.patient_name} على «${status}»`,
      entityType: "patient",
      entityId: patientId,
      source: "web",
      metadata: { recordDate, status },
    });
    return Response.json({ ...result, message: `تم ضبط ${recordDate} على «${status}»` });
  } catch (error) {
    return authorizationFailure(error, "تعذر تحديث حالة اليوم");
  }
}

/** Flag or clear a premature/incubator stay. */
export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as Row;
    const actor = await authorizeEmployeeRequest(request, clean(payload.actorName), BILLING_ROLES);
    const patientId = Number(payload.patientId);
    if (!Number.isInteger(patientId) || patientId <= 0) return Response.json({ error: "معرّف المريضة غير صحيح" }, { status: 400 });

    const { data, error } = await getSupabaseAdmin().from("patients").update({
      is_premature: Boolean(payload.isPremature),
      incubator_note: clean(payload.incubatorNote) || null,
      ...(clean(payload.admissionDate) ? { admission_date: clean(payload.admissionDate) } : {}),
    }).eq("id", patientId).select("id,full_name,admission_date,is_premature").single();
    if (error) throw error;

    await recordEmployeeActivitySafely({
      employeeName: actor.fullName,
      activityType: payload.isPremature ? "تسجيل حالة خديج" : "إلغاء حالة خديج",
      description: `${payload.isPremature ? "أدرج" : "أخرج"} ${data.full_name} ${payload.isPremature ? "ضمن" : "من"} حاضنات الخدج`,
      entityType: "patient",
      entityId: patientId,
      source: "web",
    });
    return Response.json({ patient: data, message: `تم تحديث حالة ${data.full_name}` });
  } catch (error) {
    return authorizationFailure(error, "تعذر تحديث حالة الخديج");
  }
}
