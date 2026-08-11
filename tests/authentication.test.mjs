import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/[[...view]]/page.tsx", import.meta.url), "utf8");
const landing = await readFile(new URL("../app/login-landing.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8");
const session = await readFile(new URL("../lib/session.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/202608110012_real_authentication.sql", import.meta.url), "utf8");

test("no password ever reaches the browser bundle", () => {
  for (const source of [page, landing]) {
    assert.doesNotMatch(source, /password:\s*"/, "a literal password is shipped to the client");
  }
  assert.doesNotMatch(page, /Mustafa123|Shahd123|Tabarak123|Fanar123|Ahmed123/);
});

test("the browser never decides whether a password is correct", () => {
  assert.doesNotMatch(page, /item\.password === password/);
  assert.match(page, /fetch\("\/api\/auth\/login"/);
});

test("passwords are compared against a bcrypt hash on the server", () => {
  assert.match(migration, /crypt\(p_password, account\.password_hash\)/);
  assert.match(migration, /gen_salt\('bf', 12\)/);
  assert.doesNotMatch(migration, /password_hash\s*=\s*p_password\b/, "a plaintext comparison would defeat hashing");
});

test("a wrong username and a wrong password are indistinguishable", () => {
  // Scoped to the sign-in handler: once a user is already authenticated,
  // telling them their current password is wrong reveals nothing.
  const signIn = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function DELETE"));
  const rejections = [...signIn.matchAll(/error: "([^"]*غير صحيحة[^"]*)"/g)].map((match) => match[1]);
  assert.equal(rejections.length, 1, `sign-in leaks which field was wrong: ${rejections.join(" | ")}`);
  assert.match(rejections[0], /اسم المستخدم أو كلمة المرور/);
  assert.doesNotMatch(signIn, /المستخدم غير موجود|اسم المستخدم غير صحيح/);
});

test("repeated wrong attempts lock the account for a while", () => {
  assert.match(migration, /failed_attempts \+ 1 >= 5/);
  assert.match(migration, /interval '15 minutes'/);
});

test("the session cookie cannot be read by scripts and only travels over https", () => {
  assert.match(session, /HttpOnly/);
  assert.match(session, /SameSite=Lax/);
  assert.match(session, /Secure/);
});

test("only a hash of the session token is stored", () => {
  assert.match(session, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(route, /hashToken\(token\)/);
  assert.doesNotMatch(route, /token_hash:\s*token\b/, "storing the raw token would make a database copy replayable");
});

test("signing out ends the session on the server, not just in the browser", () => {
  assert.match(route, /export async function DELETE/);
  assert.match(route, /from\("app_sessions"\)\.delete\(\)/);
  assert.match(page, /method: "DELETE"/);
});

test("changing a password ends the other sessions", () => {
  assert.match(migration, /delete from public\.app_sessions[\s\S]*?token_hash <> coalesce\(p_keep_token_hash/);
});

test("only the developer account may preview another identity", () => {
  assert.match(page, /sessionUser\?\.role === "مطور النظام" && <select/);
  assert.match(page, /const isDeveloper = sessionUser\?\.role === "مطور النظام"/);
});

test("the login screen asks for credentials, not for a name to pick", () => {
  assert.doesNotMatch(landing, /login-account-field/, "the account picker was a way in without a password");
  assert.match(landing, /autoComplete="username"/);
  assert.match(landing, /autoComplete="current-password"/);
});

test("one tap on the bell turns device notifications on", () => {
  assert.match(page, /if \(notificationPermission === "granted"\) setNotificationsOpen/);
  assert.match(page, /else enableNotifications\(\);/);
});
