import assert from "node:assert/strict";
import test from "node:test";

const { dayFeeSplit, summariseInpatientDays, INPATIENT_DAY_FEE, DAY_PAYMENT_STATES, calculateDailyCompensation } =
  await import("../lib/rules-engine.ts");

test("a day pays the doctor only once it is settled", () => {
  assert.deepEqual(dayFeeSplit("مدفوع"), { paid: INPATIENT_DAY_FEE, pending: 0 });
});

test("an unsettled day is counted, but held as expected rather than earned", () => {
  assert.deepEqual(dayFeeSplit("لم تدفع بعد"), { paid: 0, pending: INPATIENT_DAY_FEE });
});

test("a free day earns nothing in either column", () => {
  assert.deepEqual(dayFeeSplit("مجاني"), { paid: 0, pending: 0 });
});

test("the three states are the only ones offered", () => {
  assert.deepEqual([...DAY_PAYMENT_STATES], ["مدفوع", "لم تدفع بعد", "مجاني"]);
});

test("totals keep actual and expected strictly apart", () => {
  const days = [
    { status: "مدفوع" }, { status: "مدفوع" }, { status: "مدفوع" },
    { status: "لم تدفع بعد" }, { status: "لم تدفع بعد" },
    { status: "مجاني" },
  ];
  const totals = summariseInpatientDays(days);
  assert.equal(totals.paid, 3 * INPATIENT_DAY_FEE);
  assert.equal(totals.pending, 2 * INPATIENT_DAY_FEE);
  assert.deepEqual([totals.paidDays, totals.pendingDays, totals.freeDays], [3, 2, 1]);
  assert.notEqual(totals.paid, totals.paid + totals.pending, "expected must never be folded into actual");
});

test("marking a pending day as paid moves the money across, retroactively", () => {
  const before = summariseInpatientDays([{ status: "لم تدفع بعد" }, { status: "مدفوع" }]);
  const after = summariseInpatientDays([{ status: "مدفوع" }, { status: "مدفوع" }]);
  assert.equal(before.paid, INPATIENT_DAY_FEE);
  assert.equal(before.pending, INPATIENT_DAY_FEE);
  assert.equal(after.paid, 2 * INPATIENT_DAY_FEE);
  assert.equal(after.pending, 0);
  assert.equal(before.paid + before.pending, after.paid + after.pending, "the total owed must not change, only its column");
});

test("an empty stay totals to zero rather than undefined", () => {
  assert.deepEqual(summariseInpatientDays([]), { paid: 0, pending: 0, paidDays: 0, pendingDays: 0, freeDays: 0 });
});

test("the daily call sheet uses the same inpatient day fee", () => {
  const result = calculateDailyCompensation({
    consultations: 0, births: 0, cesareans: 0, paidInpatients: 4,
    maxConsultations: 10, combinedCap: 10_000_000,
  });
  assert.equal(result.enteredTotal, 4 * INPATIENT_DAY_FEE);
});
