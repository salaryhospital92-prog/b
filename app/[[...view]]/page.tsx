import { cookies } from "next/headers";
import AppShell from "../app-shell";
import { SESSION_COOKIE, userForToken } from "../../lib/session";

/**
 * Resolving the session on the server means the first HTML is already correct:
 * a visitor gets the sign-in page, a returning doctor gets their dashboard.
 * No holding screen, and no flash of the wrong one.
 */
export default async function Page() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value || "";
  let initialUser = null;
  try {
    initialUser = await userForToken(token);
  } catch {
    // An unreachable database must still serve the sign-in page.
  }
  return <AppShell initialUser={initialUser} />;
}
