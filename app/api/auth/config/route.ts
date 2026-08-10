import { readRuntimeVariable } from "../../../../lib/supabase-server";

export async function GET() {
  const url = readRuntimeVariable("SUPABASE_URL");
  const anonKey = readRuntimeVariable("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    return Response.json({ error: "إعداد تسجيل الدخول قيد التجهيز" }, { status: 503 });
  }
  return Response.json({ url, anonKey }, { headers: { "Cache-Control": "public, max-age=300" } });
}
