import { getSupabaseAdmin, readRuntimeVariable } from "../../../../lib/supabase-server";

type Row = Record<string, unknown>;

/**
 * Starts password recovery. The server, not the browser, decides whether a link
 * is worth sending: only an address already belonging to an active, approved
 * employee gets one. The reply is identical either way, so this cannot be used
 * to discover which addresses exist.
 */
export async function POST(request: Request) {
  const generic = { ok: true, message: "إن كان هذا البريد مسجلًا لموظف معتمد فسيصلك رابط خلال دقائق." };
  try {
    const payload = (await request.json()) as Row;
    const email = (typeof payload.email === "string" ? payload.email : "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "صيغة البريد الإلكتروني غير صحيحة" }, { status: 400 });
    }

    const { data: employee } = await getSupabaseAdmin().from("employees")
      .select("id").ilike("email", email).eq("status", "نشط").eq("approval_status", "معتمد").maybeSingle();
    if (!employee) return Response.json(generic);

    const url = readRuntimeVariable("SUPABASE_URL");
    const anonKey = readRuntimeVariable("SUPABASE_ANON_KEY");
    const appUrl = (readRuntimeVariable("PUBLIC_APP_URL") || new URL(request.url).origin).replace(/\/$/, "");
    if (!url || !anonKey) return Response.json({ error: "إعداد البريد غير مكتمل" }, { status: 503 });

    // create_user lets the link work for staff who have never used one before:
    // the Supabase account exists only to prove the address belongs to them.
    const response = await fetch(`${url}/auth/v1/otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ email, create_user: true, redirect_to: `${appUrl}/dashboard?reset=1` }),
    });
    if (!response.ok) {
      const detail = await response.text();
      // A rate limit is the sender protecting itself, not a failure to report.
      if (response.status === 429) return Response.json(generic);
      console.error("recovery mail failed", response.status, detail.slice(0, 200));
      return Response.json({ error: "تعذر إرسال الرابط الآن. حاول بعد قليل." }, { status: 502 });
    }
    return Response.json(generic);
  } catch {
    return Response.json({ error: "تعذر بدء الاستعادة" }, { status: 500 });
  }
}
