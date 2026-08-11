import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/app-shell.tsx", import.meta.url), "utf8");
const loginLanding = await readFile(new URL("../app/login-landing.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("every screen has its own address", () => {
  const declaration = /^type View = (.+);$/m.exec(page);
  assert.ok(declaration, "the View type is no longer declared on one line");
  const views = declaration[1].split("|").map((part) => part.trim().replace(/"/g, ""));
  const block = page.slice(page.indexOf("const VIEW_PATHS"), page.indexOf("const PATH_VIEWS"));
  for (const view of views) {
    assert.match(block, new RegExp(`\\b${view}:\\s*"/`), `${view} has no address`);
  }
});

test("no two screens share an address", () => {
  const block = page.slice(page.indexOf("const VIEW_PATHS"), page.indexOf("const PATH_VIEWS"));
  const paths = [...block.matchAll(/:\s*"(\/[a-z-]*)"/g)].map((match) => match[1]);
  assert.ok(paths.length > 10, `only ${paths.length} addresses found`);
  assert.equal(new Set(paths).size, paths.length, `duplicate address: ${paths.join(", ")}`);
});

test("the dashboard lives at /dashboard and the entrance at /", () => {
  assert.match(page, /overview:\s*"\/dashboard"/);
  assert.match(page, /viewForPath\(pathname\)/);
});

test("navigation updates the address without remounting the session", () => {
  assert.match(page, /window\.history\.pushState/);
  assert.doesNotMatch(page, /router\.push/, "a router push would remount the app and drop the session");
});

test("the back button moves between sections", () => {
  assert.match(page, /addEventListener\("popstate"/);
  assert.match(page, /removeEventListener\("popstate"/);
});

test("the typing headline reserves its tallest size so phone input never shifts", () => {
  // Both the headline and its description carry a hidden copy of every variant.
  assert.equal((loginLanding.match(/type-sizer/g) || []).length, 2);
  assert.match(loginLanding, /features\.map\(\(feature\) => <span key=\{feature\.title\}>\{feature\.title\}<\/span>\)/);
  assert.match(loginLanding, /features\.map\(\(feature\) => <span key=\{feature\.title\}>\{feature\.description\}<\/span>\)/);
  assert.match(css, /\.type-sizer\s*\{[^}]*visibility:\s*hidden/);
  assert.match(css, /\.login-feature-copy h1,\s*\.login-feature-copy p\s*\{[^}]*display:\s*grid/);
});
