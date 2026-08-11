import assert from "node:assert/strict";
import test from "node:test";

const { planMonth, daysInMonth, formatWhatsappSchedule, formatDoctorShifts, whatsappLink } =
  await import("../lib/shift-planner.ts");

const everyDay = (total) => Array.from({ length: total }, (_, index) => index + 1);

function threeResidents(total = 30) {
  return [
    { employeeId: 1, fullName: "د. شهد", availableDays: everyDay(total), preferredShift: "كلاهما" },
    { employeeId: 2, fullName: "د. تبارك", availableDays: everyDay(total), preferredShift: "كلاهما" },
    { employeeId: 3, fullName: "د. فنار", availableDays: everyDay(total), preferredShift: "كلاهما" },
  ];
}

test("covers every shift of the month when residents are available", () => {
  const plan = planMonth({ year: 2026, month: 9, doctors: threeResidents(30) });
  assert.equal(daysInMonth(2026, 9), 30);
  assert.equal(plan.assignments.length, 60);
  assert.deepEqual(plan.gaps, []);
});

test("never books a resident twice in one day, nor evening then next morning", () => {
  const plan = planMonth({ year: 2026, month: 9, doctors: threeResidents(30) });
  const perDay = new Map();
  for (const item of plan.assignments) {
    const key = `${item.day}:${item.employeeId}`;
    assert.ok(!perDay.has(key), `${item.fullName} booked twice on day ${item.day}`);
    perDay.set(key, true);
  }
  for (const item of plan.assignments.filter((entry) => entry.shift === "صباحية")) {
    const workedEveningBefore = plan.assignments.some((entry) =>
      entry.shift === "مسائية" && entry.day === item.day - 1 && entry.employeeId === item.employeeId);
    assert.ok(!workedEveningBefore, `${item.fullName} opens day ${item.day} right after a night shift`);
  }
});

test("spreads the load fairly when everyone is equally available", () => {
  const plan = planMonth({ year: 2026, month: 9, doctors: threeResidents(30) });
  const counts = plan.load.map((entry) => entry.shifts);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `unfair split: ${counts.join(",")}`);
});

test("honours declared days, shift preference, and a personal ceiling", () => {
  const plan = planMonth({
    year: 2026,
    month: 9,
    doctors: [
      { employeeId: 1, fullName: "د. شهد", availableDays: [1, 2, 3], preferredShift: "صباحية" },
      { employeeId: 2, fullName: "د. تبارك", availableDays: everyDay(30), preferredShift: "مسائية" },
      { employeeId: 3, fullName: "د. فنار", availableDays: everyDay(30), preferredShift: "كلاهما", maxShifts: 4 },
    ],
  });
  const shahd = plan.assignments.filter((item) => item.employeeId === 1);
  assert.ok(shahd.every((item) => item.shift === "صباحية" && item.day <= 3));
  assert.ok(plan.assignments.filter((item) => item.employeeId === 2).every((item) => item.shift === "مسائية"));
  assert.ok(plan.assignments.filter((item) => item.employeeId === 3).length <= 4);
});

test("reports uncovered shifts instead of inventing cover", () => {
  const plan = planMonth({
    year: 2026,
    month: 9,
    doctors: [{ employeeId: 1, fullName: "د. شهد", availableDays: [1, 2], preferredShift: "كلاهما" }],
  });
  assert.ok(plan.gaps.length > 0);
  assert.ok(plan.warnings.some((text) => text.includes("بلا طبيب متاح")));
  // One resident cannot cover both halves of the same day, so each of the two
  // declared days yields a single shift rather than a 24-hour stretch.
  assert.equal(plan.assignments.length, 2);
  assert.deepEqual(plan.assignments.map((item) => item.day), [1, 2]);
});

test("keeps hand-pinned assignments and plans around them", () => {
  const locked = [{ day: 5, shift: "مسائية", employeeId: 3, fullName: "د. فنار" }];
  const plan = planMonth({ year: 2026, month: 9, doctors: threeResidents(30), locked });
  assert.ok(plan.assignments.some((item) => item.day === 5 && item.shift === "مسائية" && item.employeeId === 3));
  assert.ok(!plan.assignments.some((item) => item.day === 6 && item.shift === "صباحية" && item.employeeId === 3));
});

test("regenerating the same month gives the identical roster", () => {
  const first = planMonth({ year: 2026, month: 9, doctors: threeResidents(30) });
  const second = planMonth({ year: 2026, month: 9, doctors: threeResidents(30) });
  assert.deepEqual(first.assignments, second.assignments);
});

test("WhatsApp export is a fenced monospace table with aligned columns", () => {
  const plan = planMonth({ year: 2026, month: 9, doctors: threeResidents(30) });
  const text = formatWhatsappSchedule({ year: 2026, month: 9, monthLabel: "أيلول 2026", assignments: plan.assignments });
  assert.equal((text.match(/```/g) || []).length, 2);
  const body = text.split("```")[1].trim().split("\n");
  assert.ok(body.length > 20);
  assert.match(text, /جدول مناوبات الأطباء المقيمين/);
  // No weekday may be clipped, and every date must land in the same column.
  assert.ok(!text.includes("…"), "a column was truncated");
  for (const name of ["الأربعاء", "الثلاثاء", "الاثنين"]) assert.ok(text.includes(name), `${name} missing`);
  const dateColumns = new Set(body.slice(2).map((line) => line.indexOf("/")));
  assert.equal(dateColumns.size, 1, `date column drifts: ${[...dateColumns].join(",")}`);
});

test("personal summary lists only that doctor's shifts", () => {
  const plan = planMonth({ year: 2026, month: 9, doctors: threeResidents(30) });
  const text = formatDoctorShifts({ year: 2026, month: 9, monthLabel: "أيلول 2026", fullName: "د. شهد", assignments: plan.assignments });
  assert.match(text, /مناوباتك في أيلول 2026/);
  assert.ok(!text.includes("د. تبارك"));
});

test("WhatsApp links normalise Iraqi numbers", () => {
  assert.ok(whatsappLink("07705693132", "مرحبا").startsWith("https://wa.me/9647705693132?text="));
  assert.ok(whatsappLink("+964 770 569 3132", "مرحبا").startsWith("https://wa.me/9647705693132?text="));
  assert.ok(whatsappLink("00964 788 466 9922", "مرحبا").startsWith("https://wa.me/9647884669922?text="));
});
