/** Pure button rendering for the guided flows — no I/O, so it stays directly testable. */

export type FlowOption = { label: string; value: string };
export type ButtonStep = { kind: "choice" | "multi" | "text" | "file"; allowText?: boolean; optional?: boolean };

const CANCEL_BUTTON = { text: "✖️ إلغاء", callback_data: "s:cancel" };

/** Two buttons per row while the labels stay short, otherwise one per row. */
function optionRows(options: FlowOption[], selected: string[]) {
  const buttons = options.map((option, index) => ({
    text: `${selected.includes(option.value) ? "✅ " : ""}${option.label}`,
    callback_data: `s:${index}`,
  }));
  if (buttons.every((button) => button.text.length <= 18)) {
    return Array.from({ length: Math.ceil(buttons.length / 2) }, (_, row) => buttons.slice(row * 2, row * 2 + 2));
  }
  return buttons.map((button) => [button]);
}

export function stepKeyboard(step: ButtonStep, options: FlowOption[], selected: string[] = []) {
  const rows: { text: string; callback_data: string }[][] = [];
  if (step.kind === "choice" || step.kind === "multi") rows.push(...optionRows(options, selected));
  if (step.kind === "multi") rows.push([{ text: `✔️ تم الاختيار (${selected.length})`, callback_data: "s:done" }]);
  if (step.optional) rows.push([{ text: "⏭️ تخطي", callback_data: "s:skip" }]);
  rows.push([CANCEL_BUTTON]);
  return { inline_keyboard: rows };
}

export function stepHint(step: ButtonStep) {
  if (step.kind === "text") return "\n\n✏️ اكتب الإجابة وأرسلها.";
  if (step.kind === "file") return "\n\n📎 أرسل الصورة أو ملف PDF الآن.";
  if (step.kind === "multi") return "\n\nاضغط على كل عنصر لتحديده، ثم اضغط «تم الاختيار».";
  if (step.allowText) return "\n\nاختر من الأزرار، أو اكتب القيمة يدويًا وأرسلها.";
  return "";
}
