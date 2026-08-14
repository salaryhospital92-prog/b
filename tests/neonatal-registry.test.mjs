import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const {
  PROCEDURE_PRICES, ENTRY_TYPES, SIDE_ROOM_ENTRY, roomKindFor,
  WARDS, DEPARTMENTS, getInitialPrice, getBillingMode, CALL_PRICES,
  calculateDailyCompensation,
} = await import("../lib/rules-engine.ts");

const shell = await readFile(new URL("../app/app-shell.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/202608110017_neonatal_registry.sql", import.meta.url), "utf8");

test("admission types are the neonatal ones, priced per day", () => {
  assert.deepEqual(ENTRY_TYPES, [
    "Incubator / O2", "CAPA (A)", "CPAP (B)", "Ventilator (A)", "Side room", "Others",
  ]);
  assert.equal(PROCEDURE_PRICES["Incubator / O2"], 160000);
  assert.equal(PROCEDURE_PRICES["CAPA (A)"], 210000);
  assert.equal(PROCEDURE_PRICES["CPAP (B)"], 160000);
  assert.equal(PROCEDURE_PRICES["Ventilator (A)"], 310000);
  assert.equal(PROCEDURE_PRICES["Side room"], 210000);
});

test("the old obstetric types are gone", () => {
  for (const retired of ["ولادة طبيعية", "عملية قيصرية", "رقود", "استشارية"]) {
    assert.ok(!(retired in PROCEDURE_PRICES), `${retired} is still an admission type`);
  }
});

test("selecting a type fills its daily rate", () => {
  assert.equal(getInitialPrice("Ventilator (A)"), 310000);
  assert.equal(getInitialPrice("Others"), 0, "Others is priced by hand");
});

test("every supported stay accrues daily", () => {
  for (const type of ENTRY_TYPES.filter((item) => item !== "Others")) {
    assert.equal(getBillingMode(type), "تراكمي", `${type} should bill per day`);
  }
});

test("a side room is a room; everything else is an incubator", () => {
  assert.equal(roomKindFor(SIDE_ROOM_ENTRY), "رقم الغرفة");
  for (const type of ENTRY_TYPES.filter((item) => item !== SIDE_ROOM_ENTRY)) {
    assert.equal(roomKindFor(type), "رقم الحاضنة");
  }
});

test("the ward list and the default department match the unit", () => {
  assert.deepEqual([...WARDS], ["خدج", "سايد روم", "أخرى"]);
  assert.equal(DEPARTMENTS[0], "قسم الأطفال وحديثي الولادة");
});

test("doctor pay is not read from the bed price", () => {
  // The family is billed PROCEDURE_PRICES; the doctor earns CALL_PRICES. Reading
  // one for the other was the bug that made a consultation cost a ventilator day.
  const result = calculateDailyCompensation({
    consultations: 2, births: 0, cesareans: 0, paidInpatients: 0,
    maxConsultations: 10, combinedCap: 1_000_000,
  });
  assert.equal(result.enteredTotal, 2 * CALL_PRICES.consultation);
});

test("the day rate is stamped on the day, not read from a constant", () => {
  assert.match(migration, /alter table public\.inpatient_payments add column if not exists day_rate/);
  assert.match(migration, /coalesce\(payment\.day_rate, 25000\) as day_rate/);
  // Two babies on different support must not share one rate.
  assert.match(migration, /effective_rate := coalesce\(/);
});

test("ward and room reach the database with the admission", () => {
  assert.match(migration, /register_neonatal_patient/);
  for (const column of ["ward", "room_kind", "room_number", "ward_note"]) {
    assert.match(migration, new RegExp(`add column if not exists ${column} text`));
  }
  assert.match(shell, /p_ward|name="ward"/);
  assert.match(shell, /roomKindFor\(patientEntryType\)/);
});

test("registering a patient is the accounts desk's screen, not the resident's", () => {
  const doctorNav = shell.slice(shell.indexOf('if (role === "doctor") return ['), shell.indexOf('if (role === "chief") return ['));
  assert.doesNotMatch(doctorNav, /id: "registry"/);
});

test("the account request offers only the roles this unit hires", () => {
  assert.match(shell, /<option>طبيب مقيم<\/option><option>التمريض<\/option><option>الحسابات<\/option>/);
  assert.match(shell, /<option>الأطفال وحديثو الولادة<\/option><option>التمريض<\/option><option>الحسابات<\/option>/);
});
