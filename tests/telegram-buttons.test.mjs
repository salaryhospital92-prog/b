import assert from "node:assert/strict";
import test from "node:test";

// Pure rendering module: no I/O, so the source imports directly under node --test.
const { stepKeyboard } = await import("../lib/telegram-buttons.ts");

const options = [
  { label: "أنثى", value: "أنثى" },
  { label: "ذكر", value: "ذكر" },
  { label: "غير محدد", value: "غير محدد" },
];

function labels(markup) {
  return markup.inline_keyboard.map((row) => row.map((button) => button.text));
}

test("choice steps pack short labels two per row and always offer cancel", () => {
  const markup = stepKeyboard({ key: "gender", prompt: "", kind: "choice" }, options);
  const rows = labels(markup);
  assert.deepEqual(rows[0], ["أنثى", "ذكر"]);
  assert.deepEqual(rows[1], ["غير محدد"]);
  assert.ok(rows.at(-1)[0].includes("إلغاء"));
});

test("long labels fall back to one button per row", () => {
  const long = [{ label: "قسم النسائية والتوليد الطارئ", value: "a" }, { label: "قسم العناية المركزة للبالغين", value: "b" }];
  const rows = labels(stepKeyboard({ key: "department", prompt: "", kind: "choice" }, long));
  assert.deepEqual(rows.slice(0, 2), [[long[0].label], [long[1].label]]);
});

test("multi steps mark selections and expose a confirm button", () => {
  const markup = stepKeyboard({ key: "patients", prompt: "", kind: "multi" }, options, ["ذكر"]);
  const flat = labels(markup).flat();
  assert.ok(flat.includes("✅ ذكر"));
  assert.ok(flat.includes("أنثى"));
  assert.ok(flat.some((text) => text.includes("تم الاختيار (1)")));
});

test("optional steps offer skip, required steps do not", () => {
  const optional = labels(stepKeyboard({ key: "notes", prompt: "", kind: "text", optional: true }, [])).flat();
  const required = labels(stepKeyboard({ key: "title", prompt: "", kind: "text" }, [])).flat();
  assert.ok(optional.some((text) => text.includes("تخطي")));
  assert.ok(!required.some((text) => text.includes("تخطي")));
});
