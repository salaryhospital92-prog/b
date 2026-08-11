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

const flows = await import("node:fs/promises").then((fs) =>
  fs.readFile(new URL("../lib/telegram-flows.ts", import.meta.url), "utf8"));
const webhook = await import("node:fs/promises").then((fs) =>
  fs.readFile(new URL("../app/api/telegram/webhook/route.ts", import.meta.url), "utf8"));
const buttons = await import("node:fs/promises").then((fs) =>
  fs.readFile(new URL("../lib/telegram-buttons.ts", import.meta.url), "utf8"));

test("ticking an item redraws its message instead of posting another", () => {
  // Selecting five days used to leave five copies of the list in the chat.
  const toggle = flows.slice(flows.indexOf('if (step.kind === "multi") {'), flows.indexOf('session.data[step.key] = option.value;'));
  assert.match(toggle, /edit: true/, "a multi-select tick must edit, not send");
  assert.match(webhook, /editTelegramMessage\(message\.chat\.id, update\.callback_query\.message\.message_id/);
});

test("the running count is visible while choosing", () => {
  // Both in the message body and on the confirm button.
  assert.match(flows, /المحدد: \$\{next\.length\}/);
  assert.match(buttons, /تم الاختيار \(\$\{selected\.length\}\)/);
});
