import assert from "node:assert/strict";
import test from "node:test";

const { isBirthEntry, parseNewbornCount, buildNewbornNames, MAX_NEWBORNS } = await import("../lib/rules-engine.ts");

test("birth entry types are the ones that imply a female patient", () => {
  assert.ok(isBirthEntry("ولادة طبيعية"));
  assert.ok(isBirthEntry("عملية قيصرية"));
  assert.ok(!isBirthEntry("استشارية"));
  assert.ok(!isBirthEntry("رقود"));
});

test("newborn count accepts presets, typed rare values, and Arabic-Indic digits", () => {
  assert.equal(parseNewbornCount("1"), 1);
  assert.equal(parseNewbornCount("2"), 2);
  assert.equal(parseNewbornCount("٥"), 5);
  assert.equal(parseNewbornCount(""), 0);
  assert.equal(parseNewbornCount(undefined), 0);
});

test("newborn count rejects nonsense instead of silently registering it", () => {
  assert.equal(parseNewbornCount("توأم"), null);
  assert.equal(parseNewbornCount("-1"), null);
  assert.equal(parseNewbornCount("2.5"), null);
  assert.equal(parseNewbornCount(String(MAX_NEWBORNS + 1)), null);
  assert.equal(parseNewbornCount(String(MAX_NEWBORNS)), MAX_NEWBORNS);
});

test("newborn names stay tied to the mother's name", () => {
  assert.deepEqual(buildNewbornNames("زينب علي", 1), ["ابن زينب علي"]);
  assert.deepEqual(buildNewbornNames("زينب علي", 2), ["الابن 1 زينب علي", "الابن 2 زينب علي"]);
  assert.deepEqual(buildNewbornNames("زينب علي", 0), []);
});
