import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const shell = await read("../app/app-shell.tsx");
const workflow = await read("../app/resident-workflow.tsx");
const workLogs = await read("../app/api/work-logs/route.ts");
const registry = await read("../app/api/registry/route.ts");
const handover = await read("../app/api/handover/route.ts");
const reports = await read("../app/api/reports/route.ts");
const session = await read("../lib/session.ts");
const rules = await read("../lib/rules-engine.ts");

test("every data endpoint checks who is asking", () => {
  // These three answered anyone at all, including hospital-wide finances.
  for (const [name, source] of [["registry", registry], ["handover", handover], ["reports", reports]]) {
    assert.match(source, /authorizeEmployeeRequest/, `${name} is still open`);
  }
  assert.match(reports, /REPORT_ROLES = \["الإدارة العليا", "رئيس المقيمين"/);
  assert.match(registry, /STAFF_ROLES = \["رئيس المقيمين"/);
});

test("a role cannot reach a screen by typing its address", () => {
  assert.match(shell, /const allowedViews = useMemo/);
  assert.match(shell, /if \(!allowedViews\.has\(view\)\)/);
  assert.match(shell, /لا تملك صلاحية هذه الشاشة/);
});

test("proof photos accept what phones actually produce", () => {
  assert.match(workLogs, /MAX_FILE_SIZE = 10 \* 1024 \* 1024/);
  // An empty or generic MIME must fall back to the extension, not be rejected.
  assert.match(workLogs, /function imageKind/);
  assert.match(workLogs, /ALLOWED_EXTENSIONS/);
});

test("replacing one proof photo does not force re-picking the rest", () => {
  assert.doesNotMatch(workLogs, /files\.length !== 0 && files\.length !== consultations/);
  assert.match(workLogs, /evidenceSlots/);
  assert.match(workLogs, /freshPaths\.get\(index\) \?\? oldEvidence\[index\]\.evidence_path/);
});

test("the call preview shows only what the database really pays", () => {
  // Special cases are logged for review and inpatient days are billed daily,
  // so neither may appear as money in the preview.
  assert.match(rules, /export const CALL_PRICES = \{\s*consultation: 10000,\s*birth: 80000,\s*\}/);
  assert.doesNotMatch(rules, /specialCase:\s*\d/);
  assert.match(workflow, /calculateCallTotal\(\{ consultations: consultationCount, births: birthCount \}\)/);
});

test("the work log no longer records caesareans", () => {
  assert.doesNotMatch(workflow, /name="cesareans"/);
  assert.doesNotMatch(workflow, /عدد القيصريات/);
});

test("the resident is not told where the record was routed", () => {
  assert.doesNotMatch(workflow, /يظهر اسم منفذ التعديل في السجل الدائم/);
  assert.doesNotMatch(workflow, /إرسال إلى الجهات الثلاث/);
});

test("the resident sidebar drops the static guide", () => {
  assert.doesNotMatch(shell, /دليل مهامي/);
});

test("remember-me decides whether the cookie outlives the browser", () => {
  assert.match(session, /export function sessionDays\(remember: boolean\)/);
  assert.match(session, /const lifetime = remember \? `; Max-Age=/);
  assert.match(shell, /body: JSON\.stringify\(\{ username, password, remember \}\)/);
});
