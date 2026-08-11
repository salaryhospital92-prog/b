/**
 * Builds a month of 12-hour morning/evening duty from what each resident said
 * they can cover. Pure and deterministic: the same input always yields the same
 * roster, so a chief can regenerate without the plan shuffling underneath them.
 */

const ARABIC_WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export type ShiftName = "صباحية" | "مسائية";
export const SHIFTS: ShiftName[] = ["صباحية", "مسائية"];

export type DoctorAvailability = {
  employeeId: number;
  fullName: string;
  /** Day-of-month numbers the doctor can take a shift on. */
  availableDays: number[];
  preferredShift: ShiftName | "كلاهما";
  /** Optional ceiling on how many shifts this doctor accepts that month. */
  maxShifts?: number | null;
};

export type Assignment = { day: number; shift: ShiftName; employeeId: number; fullName: string };
export type PlannedMonth = {
  assignments: Assignment[];
  load: { employeeId: number; fullName: string; shifts: number; morning: number; evening: number }[];
  gaps: { day: number; shift: ShiftName; missing: number }[];
  warnings: string[];
};

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

type Tracker = {
  doctor: DoctorAvailability;
  available: Set<number>;
  shifts: number;
  morning: number;
  evening: number;
  lastEveningDay: number;
  days: Set<number>;
};

function accepts(tracker: Tracker, day: number, shift: ShiftName) {
  if (!tracker.available.has(day)) return false;
  if (tracker.days.has(day)) return false; // never two shifts in one day
  if (tracker.doctor.preferredShift !== "كلاهما" && tracker.doctor.preferredShift !== shift) return false;
  const ceiling = tracker.doctor.maxShifts;
  if (typeof ceiling === "number" && tracker.shifts >= ceiling) return false;
  // A 12-hour evening ends the next morning, so the same doctor cannot open it.
  if (shift === "صباحية" && tracker.lastEveningDay === day - 1) return false;
  return true;
}

/**
 * Fairness order: fewest shifts so far wins; ties go to the doctor with the
 * fewest remaining chances to be used, so scarce availability is spent first.
 */
function pick(candidates: Tracker[], day: number) {
  return [...candidates].sort((left, right) => {
    if (left.shifts !== right.shifts) return left.shifts - right.shifts;
    const leftRemaining = [...left.available].filter((value) => value >= day).length;
    const rightRemaining = [...right.available].filter((value) => value >= day).length;
    if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;
    return left.doctor.employeeId - right.doctor.employeeId;
  })[0];
}

export function planMonth(input: {
  year: number;
  month: number;
  doctors: DoctorAvailability[];
  doctorsPerShift?: number;
  /** Assignments the chief pinned by hand; the planner works around them. */
  locked?: Assignment[];
}): PlannedMonth {
  const doctorsPerShift = Math.max(1, input.doctorsPerShift || 1);
  const total = daysInMonth(input.year, input.month);
  const trackers = new Map<number, Tracker>(input.doctors.map((doctor) => [doctor.employeeId, {
    doctor,
    available: new Set(doctor.availableDays.filter((day) => day >= 1 && day <= total)),
    shifts: 0,
    morning: 0,
    evening: 0,
    lastEveningDay: -1,
    days: new Set<number>(),
  }]));

  const assignments: Assignment[] = [];
  const gaps: PlannedMonth["gaps"] = [];
  const warnings: string[] = [];

  function record(tracker: Tracker, day: number, shift: ShiftName) {
    tracker.shifts += 1;
    tracker.days.add(day);
    if (shift === "صباحية") tracker.morning += 1;
    else { tracker.evening += 1; tracker.lastEveningDay = day; }
    assignments.push({ day, shift, employeeId: tracker.doctor.employeeId, fullName: tracker.doctor.fullName });
  }

  for (const locked of input.locked || []) {
    const tracker = trackers.get(locked.employeeId);
    if (tracker && !tracker.days.has(locked.day)) record(tracker, locked.day, locked.shift);
  }

  for (let day = 1; day <= total; day += 1) {
    for (const shift of SHIFTS) {
      const already = assignments.filter((item) => item.day === day && item.shift === shift).length;
      for (let slot = already; slot < doctorsPerShift; slot += 1) {
        const candidates = [...trackers.values()].filter((tracker) => accepts(tracker, day, shift));
        if (!candidates.length) {
          gaps.push({ day, shift, missing: doctorsPerShift - slot });
          break;
        }
        record(pick(candidates, day), day, shift);
      }
    }
  }

  if (!input.doctors.length) warnings.push("لم يرسل أي طبيب أيام تفرغه بعد، فلا يمكن توليد الجدول.");
  if (gaps.length) warnings.push(`${gaps.length} مناوبة بلا طبيب متاح — عدّلها يدويًا أو اطلب من الأطباء توسيع أيامهم.`);
  const load = [...trackers.values()]
    .map((tracker) => ({
      employeeId: tracker.doctor.employeeId,
      fullName: tracker.doctor.fullName,
      shifts: tracker.shifts,
      morning: tracker.morning,
      evening: tracker.evening,
    }))
    .sort((left, right) => right.shifts - left.shifts || left.employeeId - right.employeeId);
  const counts = load.map((entry) => entry.shifts);
  if (counts.length > 1 && Math.max(...counts) - Math.min(...counts) > 2) {
    warnings.push("توزيع المناوبات غير متوازن لأن أيام التفرغ متفاوتة بين الأطباء.");
  }

  assignments.sort((left, right) => left.day - right.day || SHIFTS.indexOf(left.shift) - SHIFTS.indexOf(right.shift) || left.employeeId - right.employeeId);
  return { assignments, load, gaps, warnings };
}

export function weekdayName(year: number, month: number, day: number) {
  return ARABIC_WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function pad(text: string, width: number) {
  const value = text.length > width ? `${text.slice(0, width - 1)}…` : text;
  return value + " ".repeat(Math.max(0, width - value.length));
}

/**
 * Monospace table wrapped in a WhatsApp code fence, so every column stays
 * aligned in the chat instead of collapsing into ragged text.
 */
export function formatWhatsappSchedule(input: {
  year: number;
  month: number;
  monthLabel: string;
  assignments: Assignment[];
  morningStart?: string;
  eveningStart?: string;
  shiftHours?: number;
}) {
  const byDay = new Map<number, { صباحية: string[]; مسائية: string[] }>();
  for (const assignment of input.assignments) {
    const entry = byDay.get(assignment.day) || { صباحية: [], مسائية: [] };
    entry[assignment.shift].push(assignment.fullName);
    byDay.set(assignment.day, entry);
  }
  const total = daysInMonth(input.year, input.month);
  // Wide enough for "الأربعاء" and "الثلاثاء" so no weekday is ever clipped.
  const dayWidth = Math.max(9, ...ARABIC_WEEKDAYS.map((name) => name.length + 1));
  const nameWidth = Math.max(14, ...input.assignments.map((item) => item.fullName.length + 2));
  const rows = [
    `${pad("اليوم", dayWidth)}${pad("التاريخ", 9)}${pad("صباحية", nameWidth)}مسائية`,
    "─".repeat(dayWidth + 9 + nameWidth + 12),
  ];
  for (let day = 1; day <= total; day += 1) {
    const entry = byDay.get(day) || { صباحية: [], مسائية: [] };
    if (!entry.صباحية.length && !entry.مسائية.length) continue;
    const date = `${String(day).padStart(2, "0")}/${String(input.month).padStart(2, "0")}`;
    rows.push(`${pad(weekdayName(input.year, input.month, day), dayWidth)}${pad(date, 9)}${pad(entry.صباحية.join("، ") || "—", nameWidth)}${entry.مسائية.join("، ") || "—"}`);
  }
  return [
    `*جدول مناوبات الأطباء المقيمين — ${input.monthLabel}*`,
    `صباحية ${input.morningStart || "08:00"} · مسائية ${input.eveningStart || "20:00"} · ${input.shiftHours || 12} ساعة`,
    "",
    "```",
    rows.join("\n"),
    "```",
    "",
    "_صادر عن نظام البياتي الطبي_",
  ].join("\n");
}

/** The same roster narrowed to one doctor, for a personal WhatsApp or bot message. */
export function formatDoctorShifts(input: {
  year: number;
  month: number;
  monthLabel: string;
  fullName: string;
  assignments: Assignment[];
  morningStart?: string;
  eveningStart?: string;
}) {
  const mine = input.assignments.filter((assignment) => assignment.fullName === input.fullName);
  if (!mine.length) return `${input.fullName}: لا توجد لك مناوبات في ${input.monthLabel}.`;
  const lines = mine.map((assignment) =>
    `• ${weekdayName(input.year, input.month, assignment.day)} ${String(assignment.day).padStart(2, "0")}/${String(input.month).padStart(2, "0")} — ${assignment.shift} (${assignment.shift === "صباحية" ? input.morningStart || "08:00" : input.eveningStart || "20:00"})`);
  return [`مناوباتك في ${input.monthLabel} (${mine.length} مناوبة):`, ...lines].join("\n");
}

/** Click-to-send WhatsApp link; works with no WhatsApp Business account. */
export function whatsappLink(phone: string, message: string) {
  const digits = phone.replace(/[^0-9]/g, "").replace(/^00/, "");
  const normalized = digits.startsWith("964") ? digits : `964${digits.replace(/^0/, "")}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
