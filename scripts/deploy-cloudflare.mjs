/**
 * Deploys the built Worker to Cloudflare and pushes the runtime variables with
 * it, so the site never goes live missing a key.
 *
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/deploy-cloudflare.mjs
 *
 * Reads values from .env.local (never committed). Run `npm run build` first —
 * vinext writes dist/server/wrangler.json with the assets binding already set.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";

const CONFIG = "dist/server/wrangler.json";
// The Worker name decides the hostname: <name>.<account-subdomain>.workers.dev
const WORKER_NAME = process.env.WORKER_NAME || "app";
const ENV_FILE = ".env.local";
const SECRET_FILE = ".wrangler/secrets.tmp.json";

// Everything the server reads through readRuntimeVariable(). Cloudflare exposes
// these on process.env because the Worker runs with nodejs_compat.
const RUNTIME_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "DEMO_MODE",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_WEBHOOK_SECRET",
  "PUBLIC_APP_URL",
];

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!process.env.CLOUDFLARE_API_TOKEN) fail("CLOUDFLARE_API_TOKEN غير مضبوط");
if (!existsSync(CONFIG)) fail(`${CONFIG} غير موجود — شغّل npm run build أولًا`);

function readEnvFile() {
  if (!existsSync(ENV_FILE)) return {};
  return Object.fromEntries(
    readFileSync(ENV_FILE, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }),
  );
}

function wrangler(args, options = {}) {
  return execFileSync("npx", ["--no-install", "wrangler", ...args], {
    stdio: options.quiet ? "pipe" : "inherit",
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

const fileEnv = readEnvFile();
const runtime = {};
for (const key of RUNTIME_KEYS) {
  const value = process.env[key] ?? fileEnv[key];
  if (value) runtime[key] = value;
}
const missing = RUNTIME_KEYS.filter((key) => !runtime[key]);
if (missing.length) fail(`قيم ناقصة في ${ENV_FILE}: ${missing.join(", ")}`);

let commit = "unknown";
let dirty = "";
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
} catch { /* deploying outside a checkout is allowed */ }

// A dirty tree would stamp the Worker with a commit that does not describe what
// is actually running — exactly the lie the version check exists to catch.
if (dirty && !process.env.ALLOW_DIRTY) {
  fail(`هناك تعديلات غير محفوظة، فبصمة النسخة لن تطابق ما يعمل فعلًا. احفظها أولًا:\n${dirty.split("\n").slice(0, 10).join("\n")}`);
}

console.log(`\nنشر إلى Cloudflare · النسخة ${commit.slice(0, 7)}\n`);
wrangler(["deploy", "-c", CONFIG, "--name", WORKER_NAME, "--var", `COMMIT_REF:${commit}`, "--var", `BUILD_TIME:${new Date().toISOString()}`]);

// Secrets go in one bulk call so a half-configured Worker is never left live.
console.log("\nرفع متغيرات التشغيل...\n");
writeFileSync(SECRET_FILE, JSON.stringify(runtime));
try {
  wrangler(["secret", "bulk", SECRET_FILE, "-c", CONFIG, "--name", WORKER_NAME]);
} finally {
  unlinkSync(SECRET_FILE);
}

console.log("\n✓ تم النشر. شغّل الآن: npm run verify -- <العنوان>\n");
