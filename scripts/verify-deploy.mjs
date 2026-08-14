/**
 * Post-deploy smoke check. Run it after every deploy; a green run is the only
 * thing that justifies telling anyone the update is live.
 *
 *   node scripts/verify-deploy.mjs [baseUrl]
 *
 * It fails loudly on the two ways this site has actually broken before:
 * a build that shipped no server handler (every route 404s), and a screen whose
 * data endpoint stops answering (the app sits on a spinner forever).
 */

const base = (process.argv[2] || process.env.PUBLIC_APP_URL || "https://albayatisys.netlify.app").replace(/\/$/, "");
const actor = encodeURIComponent("مصطفى البياتي");

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ar,en;q=0.9",
  "Cache-Control": "no-cache",
};

const checks = [];
function check(name, run) { checks.push({ name, run }); }

async function get(path, headers = {}) {
  const response = await fetch(`${base}${path}`, { headers, redirect: "follow" });
  const body = await response.text();
  return { status: response.status, body };
}

check("الصفحة الرئيسية تفتح في المتصفح", async () => {
  const { status, body } = await get("/", BROWSER_HEADERS);
  if (status !== 200) throw new Error(`رد بحالة ${status} بدل 200`);
  if (!body.includes("<title>")) throw new Error("الصفحة بلا عنوان — يبدو أنها ليست صفحة التطبيق");
  if (body.includes("Page not found")) throw new Error("الموقع يعرض صفحة خطأ Netlify");
});

check("التطبيق يُصيَّر من الخادم (وليس ملفات خام)", async () => {
  const { body } = await get("/", BROWSER_HEADERS);
  if (!body.includes("نظام البياتي")) throw new Error("محتوى التطبيق غير موجود في الصفحة");
  if (!/<script/i.test(body)) throw new Error("لا توجد حزمة جافاسكربت — البناء ناقص");
});

check("أيقونة التطبيق متاحة للمشاركة", async () => {
  const { status, body } = await get("/", BROWSER_HEADERS);
  if (status !== 200) throw new Error(`الصفحة ردت ${status}`);
  if (!body.includes("/icons/icon-512.png")) throw new Error("وسم og:image لا يشير إلى أيقونة التطبيق");
  const icon = await fetch(`${base}/icons/icon-512.png`);
  if (!icon.ok) throw new Error(`ملف الأيقونة رد ${icon.status}`);
});

check("بيانات الدخول جاهزة", async () => {
  const { status, body } = await get("/api/auth/config");
  if (status !== 200) throw new Error(`رد ${status} — متغيرات Supabase غير مضبوطة`);
  const config = JSON.parse(body);
  if (!config.url || !config.anonKey) throw new Error("إعدادات الدخول ناقصة");
});

// Every screen that loads data: if one of these stops answering, that screen
// shows a spinner and the user reports "النظام لا يعمل".
for (const [screen, path] of [
  ["سجل المرضى", `/api/registry?actorName=${actor}`],
  ["جدول المناوبات", `/api/shifts?month=2026-09&actorName=${actor}`],
  ["أيام الرقود والخدج", `/api/inpatient-days?actorName=${actor}`],
  ["الحضور والنشاط", `/api/attendance?actorName=${actor}`],
  ["سجلات المناوبات", `/api/work-logs`],
  ["التقارير", `/api/reports?period=daily&date=2026-08-11&actorName=${actor}`],
]) {
  check(`شاشة «${screen}» تستلم بياناتها`, async () => {
    const { status, body } = await get(path);
    if (status !== 200) throw new Error(`ردت بحالة ${status}: ${body.slice(0, 160)}`);
    const payload = JSON.parse(body);
    if (payload.error) throw new Error(payload.error);
  });
}

check("النسخة المنشورة هي آخر نسخة من الكود", async () => {
  const expected = process.env.EXPECT_COMMIT;
  const { status, body } = await get("/api/version");
  if (status !== 200) throw new Error(`لا يوجد مدخل نسخة — النشر قديم (رد ${status})`);
  const live = JSON.parse(body).commit;
  if (!expected) return `المنشور: ${String(live).slice(0, 7)}`;
  if (String(live).slice(0, 7) !== expected.slice(0, 7)) {
    throw new Error(`المنشور ${String(live).slice(0, 7)} بينما الكود المحلي ${expected.slice(0, 7)} — التحديث لم يصل`);
  }
  return `مطابق ${expected.slice(0, 7)}`;
});

check("مدخل البوت يرفض الطلبات غير الموقّعة", async () => {
  const response = await fetch(`${base}/api/telegram/webhook`, { method: "POST", body: "{}" });
  if (response.status !== 401) throw new Error(`المتوقع 401 لكن جاء ${response.status} — الحارس معطّل`);
});

check("البوت مربوط بهذا الموقع", async () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return "تُخطّى بلا رمز البوت";
  const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then((response) => response.json());
  if (!info.ok) throw new Error("تعذر سؤال تيليجرام");
  if (!String(info.result.url).startsWith(base)) throw new Error(`البوت موجّه إلى ${info.result.url}`);
  if (info.result.last_error_message) throw new Error(`آخر خطأ لدى تيليجرام: ${info.result.last_error_message}`);
});

const results = [];
for (const item of checks) {
  try {
    const note = await item.run();
    results.push({ ok: true, name: item.name, note });
  } catch (error) {
    results.push({ ok: false, name: item.name, note: error instanceof Error ? error.message : String(error) });
  }
}

console.log(`\nفحص النشر — ${base}\n`);
for (const result of results) {
  console.log(`${result.ok ? "✓" : "✗"} ${result.name}${result.note ? ` — ${result.note}` : ""}`);
}
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} ناجح\n`);
if (failed.length) process.exit(1);
