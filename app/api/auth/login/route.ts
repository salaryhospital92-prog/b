import { getSupabaseAdmin } from "../../../../lib/supabase-server";
import {
  currentUser,
  hashToken,
  newSessionToken,
  readSessionCookie,
  sessionCookie,
  toUser,
} from "../../../../lib/session";

type Row = Record<string, unknown>;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** Who is signed in on this browser. Used to restore a session after a reload. */
export async function GET(request: Request) {
  try {
    const user = await currentUser(request);
    return Response.json({ user }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ user: null }, { headers: { "Cache-Control": "no-store" } });
  }
}

/** Exchanges a username and password for a session cookie. */
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Row;
    const username = clean(payload.username);
    const password = typeof payload.password === "string" ? payload.password : "";
    if (!username || !password) {
      return Response.json({ error: "أدخل اسم المستخدم وكلمة المرور" }, { status: 400 });
    }

    const token = newSessionToken();
    const { data, error } = await getSupabaseAdmin().rpc("open_session", {
      p_login_name: username,
      p_password: password,
      p_token_hash: await hashToken(token),
      p_user_agent: (request.headers.get("user-agent") || "").slice(0, 200),
    });
    if (error) throw error;

    const result = data as { employee?: Row; locked_until?: string; must_change_password?: boolean } | null;
    if (result?.locked_until) {
      return Response.json({ error: "تم إيقاف المحاولات مؤقتًا بعد محاولات خاطئة متكررة. أعد المحاولة بعد 15 دقيقة." }, { status: 429 });
    }
    // One message for a wrong name and a wrong password, so neither can be probed.
    if (!result?.employee) {
      return Response.json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" }, { status: 401 });
    }

    return Response.json(
      { user: toUser({ ...result.employee, must_change_password: result.must_change_password }) },
      { headers: { "Set-Cookie": sessionCookie(token, request), "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "تعذر تسجيل الدخول" }, { status: 500 });
  }
}

/** Signs out by deleting the session server-side, not just dropping the cookie. */
export async function DELETE(request: Request) {
  try {
    const token = readSessionCookie(request);
    if (token) {
      await getSupabaseAdmin().from("app_sessions").delete().eq("token_hash", await hashToken(token));
    }
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie("", request) } });
  } catch {
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie("", request) } });
  }
}

/** Changes the signed-in user's own password and ends their other sessions. */
export async function PATCH(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });

    const payload = (await request.json()) as Row;
    const currentPassword = typeof payload.currentPassword === "string" ? payload.currentPassword : "";
    const newPassword = typeof payload.newPassword === "string" ? payload.newPassword : "";
    if (newPassword.length < 8) {
      return Response.json({ error: "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل" }, { status: 400 });
    }

    const { data, error } = await getSupabaseAdmin().rpc("change_password", {
      p_employee_id: user.id,
      p_current_password: currentPassword,
      p_new_password: newPassword,
      p_keep_token_hash: await hashToken(readSessionCookie(request)),
    });
    if (error) throw error;
    if (!data) return Response.json({ error: "كلمة المرور الحالية غير صحيحة" }, { status: 401 });

    return Response.json({ ok: true, message: "تم تغيير كلمة المرور وإنهاء الجلسات الأخرى" });
  } catch {
    return Response.json({ error: "تعذر تغيير كلمة المرور" }, { status: 500 });
  }
}
