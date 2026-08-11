/**
 * Points Supabase at a real mail relay so password-recovery links actually
 * arrive. Without one, Supabase's shared sender allows about two messages an
 * hour, which is fine for a demo and useless for a ward.
 *
 *   SUPABASE_ACCESS_TOKEN=... node scripts/configure-smtp.mjs \
 *     --host smtp-relay.brevo.com --port 587 \
 *     --user <smtp-login> --pass <smtp-key> \
 *     --sender albayati@example.com --name "نظام البياتي"
 *
 * Credentials are read from the command line or the environment and are never
 * written to the repository.
 */

const PROJECT = process.env.SUPABASE_PROJECT_REF || "zpyuurzbjhfnbrjeacbk";
const token = process.env.SUPABASE_ACCESS_TOKEN;

function argument(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : (process.env[`SMTP_${name.toUpperCase()}`] || fallback);
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!token) fail("SUPABASE_ACCESS_TOKEN غير مضبوط");

const config = {
  smtp_host: argument("host"),
  smtp_port: argument("port", "587"),
  smtp_user: argument("user"),
  smtp_pass: argument("pass"),
  smtp_admin_email: argument("sender"),
  smtp_sender_name: argument("name", "نظام البياتي"),
  // A real relay lifts the shared-sender ceiling; 30 an hour covers a ward
  // without turning a stolen address into a mail cannon.
  rate_limit_email_sent: Number(argument("rate", "30")),
  // One message per address per minute stops repeated taps from spamming.
  smtp_max_frequency: 60,
};

for (const key of ["smtp_host", "smtp_user", "smtp_pass", "smtp_admin_email"]) {
  if (!config[key]) fail(`القيمة ${key} ناقصة`);
}

const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/config/auth`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(config),
});
const body = await response.json();
if (!response.ok) fail(`رفض Supabase الإعداد: ${JSON.stringify(body).slice(0, 300)}`);

console.log("\n✓ تم ضبط خادم البريد\n");
console.log(`  الخادم       ${body.smtp_host}:${body.smtp_port}`);
console.log(`  المرسل       ${body.smtp_sender_name} <${body.smtp_admin_email}>`);
console.log(`  حد الإرسال   ${body.rate_limit_email_sent} رسالة/ساعة`);
console.log("\nاختبرها بطلب رابط استعادة من صفحة الدخول.\n");
