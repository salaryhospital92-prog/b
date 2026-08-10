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

test("server-renders the Arabic hospital dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /نظام البياتي الطبي الذكي/);
  assert.match(html, /لوحة|الرئيسية/);
  assert.match(html, /class="mobile-nav"/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /apple-touch-icon\.png/);
});

test("keeps Supabase credentials server-side and covers responsive screens", async () => {
  const [api, handoverApi, page, serverClient, css, migration, handoverMigration, exampleEnv] = await Promise.all([
    readFile(new URL("../app/api/registry/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/handover/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase-server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202608110001_initial_hospital_schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/202608110002_shift_handovers.sql", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(api, /getSupabaseAdmin/);
  assert.match(api, /register_patient/);
  assert.match(handoverApi, /create_shift_handover/);
  assert.match(handoverApi, /accept_shift_handover/);
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

  for (const table of ["employees", "patients", "patient_events", "procedures", "doctor_calls", "call_details", "inpatient_payments", "doctor_caps", "audit_logs"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(migration, /enable row level security/);
  assert.match(handoverMigration, /create table if not exists public\.doctor_shift_handovers/);
  assert.match(handoverMigration, /create table if not exists public\.handover_patients/);
  assert.match(handoverMigration, /attending_doctor = handover_record\.to_doctor_name/);
});

test("ships installable PWA icon metadata", async () => {
  const [manifest, layout] = await Promise.all([
    readFile(new URL("../app/manifest.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(manifest, /display:\s*"standalone"/);
  assert.match(manifest, /icon-maskable-512\.png/);
  assert.match(manifest, /theme_color:\s*"#113b39"/);
  assert.match(layout, /appleWebApp/);
  assert.match(layout, /themeColor:\s*"#113b39"/);
});
