import { getSupabaseAdmin, readRuntimeVariable } from "../../../lib/supabase-server";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function demoEnabled() {
  return readRuntimeVariable("DEMO_MODE") === "true";
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return fallback;
}

export async function POST(request: Request) {
  if (!demoEnabled()) return Response.json({ error: "يلزم تسجيل الدخول إلى النظام" }, { status: 403 });
  try {
    const payload = await request.json() as Record<string, unknown>;
    const callId = Number(payload.callId);
    const doctorName = clean(payload.doctorName);
    const reason = clean(payload.reason);
    const disputedAmount = Number(payload.disputedAmount);
    if (!Number.isInteger(callId) || callId <= 0 || !doctorName || reason.length < 10 || !(disputedAmount > 0)) {
      return Response.json({ error: "اكتب سببًا واضحًا وحدد مبلغ الاعتراض" }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const { data: doctor, error: doctorError } = await supabase.from("employees")
      .select("id").eq("full_name", doctorName).eq("role", "طبيب مقيم").maybeSingle();
    if (doctorError) throw doctorError;
    if (!doctor) return Response.json({ error: "حساب الطبيب غير موجود" }, { status: 404 });
    const { data: call, error: callError } = await supabase.from("doctor_calls")
      .select("id").eq("id", callId).eq("doctor_id", doctor.id).maybeSingle();
    if (callError) throw callError;
    if (!call) return Response.json({ error: "لا يمكن الاعتراض على سجل لا يخص هذا الطبيب" }, { status: 403 });
    const { data: openObjection, error: openError } = await supabase.from("doctor_call_objections")
      .select("id").eq("call_id", callId).in("status", ["مرسل", "قيد التدقيق"]).maybeSingle();
    if (openError) throw openError;
    if (openObjection) return Response.json({ error: "يوجد اعتراض مفتوح لهذا السجل بالفعل" }, { status: 409 });

    const { data, error } = await supabase.from("doctor_call_objections").insert({
      call_id: callId,
      doctor_id: doctor.id,
      doctor_name: doctorName,
      reason,
      disputed_amount: disputedAmount,
      status: "مرسل",
    }).select("*").single();
    if (error) throw error;
    return Response.json({ objection: data }, { status: 201 });
  } catch (error) {
    return Response.json({ error: errorMessage(error, "تعذر إرسال الاعتراض") }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!demoEnabled()) return Response.json({ error: "يلزم تسجيل الدخول إلى النظام" }, { status: 403 });
  try {
    const payload = await request.json() as Record<string, unknown>;
    const objectionId = Number(payload.objectionId);
    const reviewerName = clean(payload.reviewerName);
    const decision = clean(payload.decision);
    const responseNote = clean(payload.responseNote);
    const adjustmentAmount = Number(payload.adjustmentAmount || 0);
    if (!Number.isInteger(objectionId) || objectionId <= 0 || !reviewerName || !["قبول", "رفض"].includes(decision) || responseNote.length < 5 || adjustmentAmount < 0) {
      return Response.json({ error: "قرار الاعتراض أو الملاحظة غير مكتمل" }, { status: 400 });
    }
    const { data, error } = await getSupabaseAdmin().rpc("resolve_doctor_call_objection", {
      p_objection_id: objectionId,
      p_reviewer_name: reviewerName,
      p_decision: decision,
      p_response_note: responseNote,
      p_adjustment_amount: adjustmentAmount,
    });
    if (error) throw error;
    return Response.json({ objection: data });
  } catch (error) {
    return Response.json({ error: errorMessage(error, "تعذر إغلاق الاعتراض") }, { status: 500 });
  }
}
