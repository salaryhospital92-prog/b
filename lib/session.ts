import { getSupabaseAdmin } from "./supabase-server";

export const SESSION_COOKIE = "albayati_session";
const SESSION_DAYS = 30;
/** A shared ward computer should forget the doctor when the browser closes. */
const SHORT_SESSION_DAYS = 1;

export function sessionDays(remember: boolean) {
  return remember ? SESSION_DAYS : SHORT_SESSION_DAYS;
}

export type SessionUser = {
  id: number;
  fullName: string;
  role: string;
  specialty: string;
  username: string;
  mustChangePassword: boolean;
};

/** Only the hash is stored, so a database copy cannot be replayed as a login. */
export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function readSessionCookie(request: Request) {
  const header = request.headers.get("cookie") || "";
  const match = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : "";
}

export function sessionCookie(token: string, request: Request, remember = true) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  // Without "remember me" the cookie has no Max-Age, so it dies with the browser.
  if (!token) return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
  const lifetime = remember ? `; Max-Age=${SESSION_DAYS * 24 * 60 * 60}` : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}${lifetime}`;
}

function toUser(row: Record<string, unknown>): SessionUser {
  return {
    id: Number(row.id),
    fullName: String(row.full_name),
    role: String(row.role),
    specialty: String(row.specialty || ""),
    username: String(row.username || ""),
    mustChangePassword: Boolean(row.must_change_password),
  };
}

/** Resolves a raw session token to its employee, or null when it is not live. */
export async function userForToken(token: string): Promise<SessionUser | null> {
  if (!token) return null;
  const { data, error } = await getSupabaseAdmin().rpc("resume_session", { p_token_hash: await hashToken(token) });
  if (error) throw error;
  return data ? toUser(data as Record<string, unknown>) : null;
}

/** Resolves the caller from their cookie, or null when there is no live session. */
export async function currentUser(request: Request): Promise<SessionUser | null> {
  return userForToken(readSessionCookie(request));
}

export { toUser };
