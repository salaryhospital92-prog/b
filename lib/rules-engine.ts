export const PROCEDURE_PRICES = {
  "ولادة طبيعية": 10000,
  "عملية قيصرية": 60000,
  "رقود": 0,
  "استشارية": 10000,
} as const;

export function buildNewbornNames(motherName: string, newbornCount: number) {
  const name = motherName.trim();
  if (!name || newbornCount <= 0) return [];
  if (newbornCount === 1) return [`ابن ${name}`];
  return Array.from({ length: newbornCount }, (_, index) => `الابن ${index + 1} ${name}`);
}

export function getBillingMode(entryType: string) {
  return entryType === "رقود" ? "تراكمي" : "مقطوعي";
}

export function getInitialPrice(entryType: string) {
  return PROCEDURE_PRICES[entryType as keyof typeof PROCEDURE_PRICES] ?? 0;
}

export function calculateDailyCompensation(input: {
  consultations: number;
  births: number;
  cesareans: number;
  paidInpatients: number;
  maxConsultations: number;
  combinedCap: number;
}) {
  const consultationEntered = input.consultations * PROCEDURE_PRICES["استشارية"];
  const consultationApproved = Math.min(input.consultations, input.maxConsultations) * PROCEDURE_PRICES["استشارية"];
  const combinedEntered = input.births * 80000 + input.cesareans * 120000 + input.paidInpatients * 25000;
  const combinedApproved = Math.min(combinedEntered, input.combinedCap);
  return {
    enteredTotal: consultationEntered + combinedEntered,
    approvedTotal: consultationApproved + combinedApproved,
    capDiscount: consultationEntered - consultationApproved + combinedEntered - combinedApproved,
  };
}
