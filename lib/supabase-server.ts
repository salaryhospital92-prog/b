import { env } from "cloudflare:workers";
import { createClient } from "@supabase/supabase-js";

export function readRuntimeVariable(name: string) {
  const workerEnv = env as unknown as Record<string, string | undefined>;
  return workerEnv[name] || process.env[name];
}

export function getSupabaseAdmin() {
  const url = readRuntimeVariable("SUPABASE_URL");
  const serviceRoleKey = readRuntimeVariable("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase runtime variables are not configured");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
