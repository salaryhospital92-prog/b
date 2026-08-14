/**
 * What a neonatal admission costs per day. The type describes the support the
 * baby is on, and the family is billed for every day that support continues —
 * so these are daily rates, not one-off charges.
 */
export const PROCEDURE_PRICES = {
  "Incubator / O2": 160000,
  "CAPA (A)": 210000,
  "CPAP (B)": 160000,
  "Ventilator (A)": 310000,
  "Side room": 210000,
  "Others": 0,
} as const;

export const ENTRY_TYPES = Object.keys(PROCEDURE_PRICES) as (keyof typeof PROCEDURE_PRICES)[];

/** A side room is a room; everything else is an incubator bay. */
export const SIDE_ROOM_ENTRY = "Side room";

export function roomKindFor(entryType: string) {
  return entryType === SIDE_ROOM_ENTRY ? "رقم الغرفة" : "رقم الحاضنة";
}

export const WARDS = ["خدج", "سايد روم", "أخرى"] as const;
export const ROOM_KINDS = ["رقم الغرفة", "رقم الحاضنة", "أخرى"] as const;

export const DEPARTMENTS = [
  "قسم الأطفال وحديثي الولادة",
  "العناية المركزة",
  "الطوارئ",
  "النسائية والتوليد",
  "أخرى",
] as const;

/**
 * What a single call pays the resident, per case. These are the same figures the
 * database applies in save_resident_work_log; the form previews them so a doctor
 * sees the number before submitting rather than after the audit.
 */
export const CALL_PRICES = {
  consultation: 10000,
  birth: 80000,
} as const;

/**
 * The call's own total, before the doctor's caps are applied. Special cases are
 * recorded for review but carry no fee, and inpatient days are billed
 * separately once payment is confirmed — neither belongs in this figure.
 */
export function calculateCallTotal(input: { consultations: number; births: number }) {
  return input.consultations * CALL_PRICES.consultation + input.births * CALL_PRICES.birth;
}

/** What one inpatient day pays the attending doctor once the family settles it. */
export const INPATIENT_DAY_FEE = 25000;

/** The only three states an inpatient day can be in. */
export const DAY_PAYMENT_STATES = ["مدفوع", "لم تدفع بعد", "مجاني"] as const;
export type DayPaymentState = (typeof DAY_PAYMENT_STATES)[number];

/**
 * A day earns the doctor his fee only once it is paid; an unpaid day is still
 * worth something but stays pending, and a free day is worth nothing at all.
 */
export function dayFeeSplit(status: DayPaymentState) {
  if (status === "مدفوع") return { paid: INPATIENT_DAY_FEE, pending: 0 };
  if (status === "لم تدفع بعد") return { paid: 0, pending: INPATIENT_DAY_FEE };
  return { paid: 0, pending: 0 };
}

/** Totals a doctor's inpatient days into the actual and the still-expected column. */
export function summariseInpatientDays(days: { status: DayPaymentState }[]) {
  return days.reduce((totals, day) => {
    const split = dayFeeSplit(day.status);
    return {
      paid: totals.paid + split.paid,
      pending: totals.pending + split.pending,
      paidDays: totals.paidDays + (day.status === "مدفوع" ? 1 : 0),
      pendingDays: totals.pendingDays + (day.status === "لم تدفع بعد" ? 1 : 0),
      freeDays: totals.freeDays + (day.status === "مجاني" ? 1 : 0),
    };
  }, { paid: 0, pending: 0, paidDays: 0, pendingDays: 0, freeDays: 0 });
}

/** Upper bound on a single birth; anything higher is a data-entry slip, not a delivery. */
export const MAX_NEWBORNS = 10;

/**
 * Kept for the older records and the bot's own flow. The neonatal registry has
 * no birth admission types, so this is false for everything it creates.
 */
export function isBirthEntry(entryType: string) {
  return entryType === "ولادة طبيعية" || entryType === "عملية قيصرية";
}

/** Accepts the preset counts and a hand-typed one for rare births. Null means invalid. */
export function parseNewbornCount(value: unknown): number | null {
  const digits = String(value ?? "").trim().replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  if (!digits) return 0;
  if (!/^\d+$/.test(digits)) return null;
  const count = Number(digits);
  return count > MAX_NEWBORNS ? null : count;
}

export function buildNewbornNames(motherName: string, newbornCount: number) {
  const name = motherName.trim();
  if (!name || newbornCount <= 0) return [];
  if (newbornCount === 1) return [`ابن ${name}`];
  return Array.from({ length: newbornCount }, (_, index) => `الابن ${index + 1} ${name}`);
}

export function getBillingMode(entryType: string) {
  // Neonatal support is charged for every day it continues.
  return entryType === "Others" ? "مقطوعي" : "تراكمي";
}

export function getInitialPrice(entryType: string) {
  return PROCEDURE_PRICES[entryType as keyof typeof PROCEDURE_PRICES] ?? 0;
}

/**
 * What a doctor earns for a day's work. Doctor pay comes from CALL_PRICES, not
 * from PROCEDURE_PRICES — the latter is what the family is billed for a bed,
 * which is a different number for a different party.
 */
export function calculateDailyCompensation(input: {
  consultations: number;
  births: number;
  cesareans: number;
  paidInpatients: number;
  maxConsultations: number;
  combinedCap: number;
}) {
  const consultationEntered = input.consultations * CALL_PRICES.consultation;
  const consultationApproved = Math.min(input.consultations, input.maxConsultations) * CALL_PRICES.consultation;
  const combinedEntered = input.births * CALL_PRICES.birth + input.cesareans * 120000 + input.paidInpatients * INPATIENT_DAY_FEE;
  const combinedApproved = Math.min(combinedEntered, input.combinedCap);
  return {
    enteredTotal: consultationEntered + combinedEntered,
    approvedTotal: consultationApproved + combinedApproved,
    capDiscount: consultationEntered - consultationApproved + combinedEntered - combinedApproved,
  };
}
