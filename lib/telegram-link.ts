import { getSupabaseAdmin, readRuntimeVariable } from "./supabase-server";

const LINK_CODE_TTL_MINUTES = 15;

function createCode() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}

/**
 * Issues a single-use pairing code for an employee and returns the deep link
 * that pairs their Telegram account. Shared by the web dashboard and the bot
 * so both surfaces stay on the same rules.
 */
export async function createLinkCode(employeeId: number, createdBy: number) {
  const supabase = getSupabaseAdmin();
  await supabase.from("telegram_link_codes").delete().eq("employee_id", employeeId).is("used_at", null);
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MINUTES * 60 * 1000).toISOString();
  let code = "";
  let insertError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    code = createCode();
    const { error } = await supabase.from("telegram_link_codes").insert({
      code,
      employee_id: employeeId,
      created_by: createdBy,
      expires_at: expiresAt,
    });
    if (!error) { insertError = null; break; }
    insertError = error;
  }
  if (insertError) throw insertError;
  const botUsername = readRuntimeVariable("TELEGRAM_BOT_USERNAME") || "Albayati_sysbot";
  return { code, expiresAt, deepLink: `https://t.me/${botUsername}?start=${code}`, ttlMinutes: LINK_CODE_TTL_MINUTES };
}
