import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export async function getSupabaseBrowser() {
  if (browserClient) return browserClient;
  const response = await fetch("/api/auth/config");
  const config = await response.json() as { url?: string; anonKey?: string; error?: string };
  if (!response.ok || !config.url || !config.anonKey) {
    throw new Error(config.error || "تعذر تهيئة تسجيل الدخول");
  }
  browserClient = createClient(config.url, config.anonKey, {
    auth: { detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  });
  return browserClient;
}
