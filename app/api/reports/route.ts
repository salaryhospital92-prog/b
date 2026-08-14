import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { authorizationFailure, authorizeEmployeeRequest } from "../../../lib/authorization";

// Hospital-wide finances: management and the chief resident only.
const REPORT_ROLES = ["الإدارة العليا", "رئيس المقيمين", "مطور النظام"];

type Period = "daily" | "weekly" | "monthly";
type NumberLike = number | string | null;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function getRange(period: Period, selectedDate: string) {
  const anchor = new Date(`${selectedDate}T00:00:00.000Z`);
  if (Number.isNaN(anchor.getTime())) throw new Error("Invalid report date");

  let start = new Date(anchor);
  if (period === "weekly") {
    const daysFromSaturday = (anchor.getUTCDay() + 1) % 7;
    start = addDays(anchor, -daysFromSaturday);
  } else if (period === "monthly") {
    start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  }

  const endExclusive = period === "daily"
    ? addDays(start, 1)
    : period === "weekly"
      ? addDays(start, 7)
      : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));

  return {
    start,
    endExclusive,
    startDate: isoDate(start),
    endDate: isoDate(addDays(endExclusive, -1)),
    startIso: start.toISOString(),
    endExclusiveIso: endExclusive.toISOString(),
  };
}

function sum(rows: Record<string, unknown>[], field: string) {
  return rows.reduce((total, row) => total + Number((row[field] as NumberLike) || 0), 0);
}

function safePeriod(value: string | null): Period {
  return value === "weekly" || value === "monthly" ? value : "daily";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    await authorizeEmployeeRequest(request, url.searchParams.get("actorName")?.trim() || "", REPORT_ROLES);
    const period = safePeriod(url.searchParams.get("period"));
    const selectedDate = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      return Response.json({ error: "التاريخ المحدد غير صحيح" }, { status: 400 });
    }

    const range = getRange(period, selectedDate);
    const supabase = getSupabaseAdmin();
    const [patientsResult, eventsResult, callsResult, paymentsResult, handoversResult, transactionsResult, activeResult] = await Promise.all([
      supabase.from("patients").select("id,admission_date,is_newborn,entry_type,patient_status")
        .gte("admission_date", range.startDate).lte("admission_date", range.endDate),
      supabase.from("patient_events").select("created_at,event_type,amount")
        .eq("is_invalidated", false).gte("created_at", range.startIso).lt("created_at", range.endExclusiveIso),
      supabase.from("doctor_calls").select("doctor_id,call_date,total_calculated,total_approved")
        .gte("call_date", range.startDate).lte("call_date", range.endDate),
      supabase.from("inpatient_payments").select("record_date,payment_status")
        .gte("record_date", range.startDate).lte("record_date", range.endDate),
      supabase.from("doctor_shift_handovers").select("id,to_doctor_name,accepted_at")
        .eq("status", "تم الاستلام").gte("accepted_at", range.startIso).lt("accepted_at", range.endExclusiveIso),
      supabase.from("financial_transactions").select("transaction_date,transaction_type,category,amount")
        .gte("transaction_date", range.startDate).lte("transaction_date", range.endDate),
      supabase.from("patients").select("id", { count: "exact", head: true }).neq("patient_status", "خرجت"),
    ]);

    for (const result of [patientsResult, eventsResult, callsResult, paymentsResult, handoversResult, transactionsResult, activeResult]) {
      if (result.error) throw result.error;
    }

    const patients = (patientsResult.data || []) as Record<string, unknown>[];
    const events = (eventsResult.data || []) as Record<string, unknown>[];
    const calls = (callsResult.data || []) as Record<string, unknown>[];
    const payments = (paymentsResult.data || []) as Record<string, unknown>[];
    const handovers = (handoversResult.data || []) as Record<string, unknown>[];
    const transactions = (transactionsResult.data || []) as Record<string, unknown>[];

    const handoverIds = handovers.map((row) => Number(row.id)).filter(Number.isFinite);
    const handoverPatientsResult = handoverIds.length
      ? await supabase.from("handover_patients").select("handover_id").in("handover_id", handoverIds)
      : { data: [], error: null };
    if (handoverPatientsResult.error) throw handoverPatientsResult.error;

    const receivedByHandover = ((handoverPatientsResult.data || []) as Record<string, unknown>[]).reduce<Record<number, number>>((totals, row) => {
      const id = Number(row.handover_id);
      totals[id] = (totals[id] || 0) + 1;
      return totals;
    }, {});
    const receivedByDoctor = handovers.reduce<Record<string, number>>((totals, row) => {
      const name = String(row.to_doctor_name || "غير محدد");
      totals[name] = (totals[name] || 0) + (receivedByHandover[Number(row.id)] || 0);
      return totals;
    }, {});

    const expenses = sum(transactions.filter((row) => row.transaction_type === "مصروف"), "amount");
    const recordedRevenue = sum(transactions.filter((row) => row.transaction_type === "إيراد"), "amount");
    const clinicalRevenue = sum(events, "amount");
    const salaries = sum(calls, "total_approved");
    const revenue = recordedRevenue + clinicalRevenue;
    const birthEntries = new Set(["ولادة طبيعية", "عملية قيصرية"]);

    const daily: Record<string, { date: string; patients: number; births: number; revenue: number; expenses: number; salaries: number }> = {};
    for (let date = new Date(range.start); date < range.endExclusive; date = addDays(date, 1)) {
      const key = isoDate(date);
      daily[key] = { date: key, patients: 0, births: 0, revenue: 0, expenses: 0, salaries: 0 };
    }
    patients.forEach((row) => {
      const key = String(row.admission_date);
      if (!daily[key] || row.is_newborn) return;
      daily[key].patients += 1;
      if (birthEntries.has(String(row.entry_type))) daily[key].births += 1;
    });
    events.forEach((row) => {
      const key = String(row.created_at).slice(0, 10);
      if (daily[key]) daily[key].revenue += Number(row.amount || 0);
    });
    calls.forEach((row) => {
      const key = String(row.call_date);
      if (daily[key]) daily[key].salaries += Number(row.total_approved || 0);
    });
    transactions.forEach((row) => {
      const key = String(row.transaction_date);
      if (!daily[key]) return;
      if (row.transaction_type === "مصروف") daily[key].expenses += Number(row.amount || 0);
      if (row.transaction_type === "إيراد") daily[key].revenue += Number(row.amount || 0);
    });

    return Response.json({
      period,
      selectedDate,
      range: { start: range.startDate, end: range.endDate },
      summary: {
        patients: patients.filter((row) => !row.is_newborn).length,
        newborns: patients.filter((row) => row.is_newborn).length,
        birthCases: patients.filter((row) => !row.is_newborn && birthEntries.has(String(row.entry_type))).length,
        expenses,
        salaries,
        revenue,
        net: revenue - expenses - salaries,
        acceptedHandovers: handovers.length,
        receivedPatients: Object.values(receivedByDoctor).reduce((total, count) => total + count, 0),
        paidInpatientDays: payments.filter((row) => row.payment_status === "مدفوع").length,
        pendingPayments: payments.filter((row) => row.payment_status === "ليس بعد" || row.payment_status === "معلق").length,
        freeInpatientDays: payments.filter((row) => row.payment_status === "مجاني").length,
        activePatients: activeResult.count || 0,
      },
      topDoctors: Object.entries(receivedByDoctor)
        .map(([name, patientsReceived]) => ({ name, patientsReceived }))
        .sort((a, b) => b.patientsReceived - a.patientsReceived || a.name.localeCompare(b.name, "ar"))
        .slice(0, 5),
      dailySeries: Object.values(daily),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر إنشاء التقرير";
    return authorizationFailure(error, message.includes("runtime variables") ? "الاتصال بقاعدة البيانات قيد التجهيز" : message);
  }
}
