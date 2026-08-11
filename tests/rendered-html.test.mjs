import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Arabic hospital entry experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /نظام البياتي الطبي الذكي/);
  assert.match(html, /تسجيل الدخول/);
  assert.match(html, /حساب شخصي لا يختلط بغيره/);
  assert.match(html, /class="login-page"/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /apple-touch-icon\.png/);
});

test("keeps Supabase credentials server-side and covers responsive screens", async () => {
  const [api, handoverApi, reportApi, accessApi, workLogApi, objectionApi, browserClient, page, residentWorkflow, serverClient, css, migration, handoverMigration, reportingMigration, residentMigration, exampleEnv] = await Promise.all([
    readFile(new URL("../app/api/registry/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/handover/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reports/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/access-requests/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/work-logs/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/objections/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase-browser.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/resident-workflow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase-server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202608110001_initial_hospital_schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202608110002_shift_handovers.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202608110003_reporting_and_access.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202608110004_resident_workflow.sql", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(api, /getSupabaseAdmin/);
  assert.match(api, /register_patient/);
  assert.match(handoverApi, /create_shift_handover/);
  assert.match(handoverApi, /accept_shift_handover/);
  assert.match(reportApi, /financial_transactions/);
  assert.match(reportApi, /topDoctors/);
  assert.match(accessApi, /auth\.getUser\(token\)/);
  assert.match(accessApi, /بانتظار الموافقة/);
  assert.match(accessApi, /رئيس المقيمين/);
  assert.match(workLogApi, /save_resident_work_log/);
  assert.match(workLogApi, /consultationEvidence/);
  assert.match(workLogApi, /createSignedUrls/);
  assert.match(objectionApi, /resolve_doctor_call_objection/);
  assert.doesNotMatch(browserClient, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(serverClient, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(api, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(exampleEnv, /eyJ|sb_secret_|service_role\.[A-Za-z0-9]/);

  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 380px\)/);
  assert.match(css, /min-width:\s*320px/);
  assert.match(css, /sidebar-collapsed/);
  assert.match(css, /handover-layout/);
  assert.match(page, /Intl\.NumberFormat\("en-US"\)/);
  assert.match(page, /استلام المناوبة/);
  assert.match(page, /التقارير اليومية والأسبوعية والشهرية/);
  assert.match(page, /المتابعة عبر Google/);
  assert.match(page, /doctor-fanar/);
  assert.match(page, /"doctor-tabarak"[\s\S]*firstName:\s*"تبارك"/);
  assert.match(page, /doctorProfiles\[activeAccountId\]/);
  assert.match(page, /globalSearchResults/);
  assert.match(page, /مركز الإشعارات/);
  assert.match(page, /developer-system/);
  assert.match(page, /brand-mark/);
  assert.match(page, /sidebarExpanded \? "→" : "←"/);
  assert.match(residentWorkflow, /سجل التعديلات الكامل/);
  assert.match(residentWorkflow, /صورة لكل حالة استشارية/);
  assert.match(residentWorkflow, /اعتراضاتي المالية/);
  assert.match(css, /data-theme="dark"/);
  assert.match(css, /report-kpis/);
  assert.match(css, /visual clarity pass/);
  assert.match(css, /\.payment-row[^}]*font-size:\s*13px/);
  assert.match(css, /--cream:\s*#0e241e/);
  assert.match(css, /background-image:\s*url\("\/icons\/icon-192\.png"\)/);
  assert.match(css, /sidebar-collapsed \.nav-icon[^}]*font-size:\s*26px/);

  for (const table of ["employees", "patients", "patient_events", "procedures", "doctor_calls", "call_details", "inpatient_payments", "doctor_caps", "audit_logs"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(migration, /enable row level security/);
  assert.match(handoverMigration, /create table if not exists public\.doctor_shift_handovers/);
  assert.match(handoverMigration, /create table if not exists public\.handover_patients/);
  assert.match(handoverMigration, /attending_doctor = handover_record\.to_doctor_name/);
  assert.match(reportingMigration, /create table if not exists public\.financial_transactions/);
  assert.match(reportingMigration, /create table if not exists public\.system_access_requests/);
  for (const table of ["doctor_call_consultations", "doctor_call_revisions", "doctor_call_deliveries", "doctor_call_objections"]) {
    assert.match(residentMigration, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(residentMigration, /create or replace function public\.save_resident_work_log/);
  assert.match(residentMigration, /create or replace function public\.resolve_doctor_call_objection/);
  assert.match(residentMigration, /consultation-evidence/);
  assert.match(residentMigration, /last_edited_by_name/);
});

test("ships installable PWA icon metadata and notification worker", async () => {
  const [manifest, layout, worker, loginLanding] = await Promise.all([
    readFile(new URL("../app/manifest.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../app/login-landing.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(manifest, /display:\s*"standalone"/);
  assert.match(manifest, /icon-maskable-512\.png/);
  assert.match(manifest, /theme_color:\s*"#0b5144"/);
  assert.match(layout, /appleWebApp/);
  assert.match(layout, /themeColor:\s*"#0b5144"/);
  assert.match(worker, /addEventListener\("push"/);
  assert.match(worker, /addEventListener\("notificationclick"/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(loginLanding, /beforeinstallprompt|onInstall/);
  assert.match(loginLanding, /iPhone/);
});

test("prepares Netlify without allowing an automatic release", async () => {
  const [config, gate, packageJson, setup] = await Promise.all([
    readFile(new URL("../netlify.toml", import.meta.url), "utf8"),
    readFile(new URL("../scripts/netlify-build-gate.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../NETLIFY_SETUP.md", import.meta.url), "utf8"),
  ]);

  assert.match(config, /command = "npm run build:netlify"/);
  assert.match(config, /publish = "\.next"/);
  assert.match(config, /ignore = "node \.\/scripts\/netlify-build-gate\.mjs"/);
  assert.match(gate, /NETLIFY_RELEASE_APPROVED === "true"/);
  assert.match(packageJson, /"next": "16\.3\.0"/);
  assert.match(setup, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(`${config}\n${gate}\n${packageJson}\n${setup}`, /nfp_[A-Za-z0-9]+/);
});
