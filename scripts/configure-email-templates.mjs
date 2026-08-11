/**
 * Installs the Albayati mail templates in Supabase: Arabic first, English
 * underneath, so the same message serves everyone without a second send.
 *
 *   SUPABASE_ACCESS_TOKEN=... node scripts/configure-email-templates.mjs
 *
 * Styles are inline because mail clients discard <style> blocks, and the layout
 * is a single centred table for the same reason.
 */

const PROJECT = process.env.SUPABASE_PROJECT_REF || "zpyuurzbjhfnbrjeacbk";
const APP_URL = process.env.PUBLIC_APP_URL || "https://app.albayati.workers.dev";
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token) {
  console.error("\n✗ SUPABASE_ACCESS_TOKEN غير مضبوط\n");
  process.exit(1);
}

const TEAL = "#0f7569";
const TEAL_DARK = "#0a5c53";
const INK = "#142b2b";
const MUTED = "#738381";
const LINE = "#dce9e3";

/** One frame for every message: brand, Arabic, rule, English, footer. */
function layout({ arabic, english, action, actionEnglish }) {
  return `<div style="margin:0;padding:24px 12px;background:#eef4f1;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:16px;overflow:hidden;">
    <tr>
      <td style="padding:22px 26px;background:linear-gradient(135deg,${TEAL_DARK},${TEAL});">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td align="right" style="color:#ffffff;font-size:19px;font-weight:700;">نظام البياتي الطبي الذكي</td>
            <td align="left" style="color:rgba(255,255,255,.78);font-size:12px;">Albayati Medical System</td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td dir="rtl" align="right" style="padding:26px 26px 4px;color:${INK};">
        ${arabic}
      </td>
    </tr>

    <tr>
      <td align="center" style="padding:18px 26px;">
        <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:13px 30px;border-radius:11px;background:${TEAL};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">${action}</a>
        <div style="margin-top:9px;color:${MUTED};font-size:11px;">${actionEnglish}</div>
      </td>
    </tr>

    <tr><td style="padding:0 26px;"><div style="height:1px;background:${LINE};"></div></td></tr>

    <tr>
      <td dir="ltr" align="left" style="padding:18px 26px 4px;color:${MUTED};font-size:13px;line-height:1.7;">
        ${english}
      </td>
    </tr>

    <tr>
      <td style="padding:16px 26px 22px;">
        <div style="padding:11px 13px;border-radius:9px;background:#f4faf7;color:${MUTED};font-size:11px;line-height:1.7;word-break:break-all;">
          <div dir="rtl" style="text-align:right;">إن لم يعمل الزر، انسخ هذا الرابط:</div>
          <div dir="ltr" style="text-align:left;">If the button does not work, copy this link:</div>
          <a href="{{ .ConfirmationURL }}" style="color:${TEAL};">{{ .ConfirmationURL }}</a>
        </div>
      </td>
    </tr>

    <tr>
      <td align="center" style="padding:14px 26px 20px;border-top:1px solid ${LINE};color:${MUTED};font-size:10px;">
        <div dir="rtl">رسالة آلية من نظام البياتي · لا ترد عليها</div>
        <div dir="ltr" style="margin-top:3px;">Automated message from Albayati · Do not reply</div>
        <a href="${APP_URL}" style="color:${TEAL};text-decoration:none;">${APP_URL.replace(/^https?:\/\//, "")}</a>
      </td>
    </tr>
  </table>
</div>`;
}

const heading = (text) => `<div style="font-size:20px;font-weight:700;margin:0 0 10px;">${text}</div>`;
const paragraph = (text) => `<div style="font-size:14px;line-height:1.9;color:${INK};margin:0 0 8px;">${text}</div>`;

const templates = {
  mailer_templates_magic_link_content: layout({
    arabic: heading("رابط الدخول إلى حسابك") + paragraph("وصلنا طلب دخول لحسابك في نظام البياتي. اضغط الزر أدناه للمتابعة. الرابط صالح لمدة ساعة ويُستخدم مرة واحدة.") + paragraph("إن لم تطلب هذا، تجاهل الرسالة ولن يتغير شيء."),
    english: "<b>Your sign-in link</b><br>We received a sign-in request for your Albayati account. The link below is valid for one hour and works once. If you did not request it, ignore this message and nothing will change.",
    action: "الدخول إلى النظام",
    actionEnglish: "Sign in to Albayati",
  }),
  mailer_templates_recovery_content: layout({
    arabic: heading("استعادة كلمة المرور") + paragraph("وصلنا طلب لتعيين كلمة مرور جديدة لحسابك. اضغط الزر أدناه لاختيارها. الرابط صالح لمدة ساعة.") + paragraph("بعد التعيين ستُنهى جلساتك على الأجهزة الأخرى. إن لم تطلب هذا فتجاهل الرسالة، وكلمة مرورك الحالية تبقى كما هي."),
    english: "<b>Reset your password</b><br>We received a request to set a new password for your account. The link below is valid for one hour. Signing in elsewhere will end after you set it. If you did not ask for this, ignore the message and your current password stays unchanged.",
    action: "تعيين كلمة مرور جديدة",
    actionEnglish: "Set a new password",
  }),
  mailer_templates_confirmation_content: layout({
    arabic: heading("تأكيد بريدك الإلكتروني") + paragraph("أكّد أن هذا البريد يخصك لتتمكن من استعادة حسابك عند الحاجة.") + paragraph("إن لم تطلب هذا، تجاهل الرسالة."),
    english: "<b>Confirm your email address</b><br>Confirm this address belongs to you so it can be used to recover your account. If you did not request this, ignore the message.",
    action: "تأكيد البريد",
    actionEnglish: "Confirm email address",
  }),
  mailer_templates_invite_content: layout({
    arabic: heading("دعوة إلى نظام البياتي") + paragraph("تمت دعوتك للانضمام إلى نظام البياتي الطبي. اضغط الزر لإكمال التفعيل.") + paragraph("إن وصلتك بالخطأ فتجاهلها."),
    english: "<b>You have been invited</b><br>You were invited to join the Albayati Medical System. Use the button to finish activation. If this reached you by mistake, ignore it.",
    action: "قبول الدعوة",
    actionEnglish: "Accept invitation",
  }),
};

// Subjects carry both languages too: the inbox list is the first thing read.
const subjects = {
  mailer_subjects_magic_link: "رابط الدخول إلى نظام البياتي · Your Albayati sign-in link",
  mailer_subjects_recovery: "استعادة كلمة المرور · Reset your Albayati password",
  mailer_subjects_confirmation: "تأكيد بريدك · Confirm your Albayati email",
  mailer_subjects_invite: "دعوة إلى نظام البياتي · You are invited to Albayati",
};

const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/config/auth`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ ...templates, ...subjects }),
});
const body = await response.json();
if (!response.ok) {
  console.error(`\n✗ رفض Supabase القوالب: ${JSON.stringify(body).slice(0, 300)}\n`);
  process.exit(1);
}

console.log("\n✓ تم تركيب القوالب ثنائية اللغة\n");
for (const key of Object.keys(subjects)) console.log(`  ${key.replace("mailer_subjects_", "").padEnd(14)} ${body[key]}`);
console.log("");
