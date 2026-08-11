"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Profile = {
  id: number; full_name: string; email: string | null; phone: string | null;
  role: string; specialty: string; employee_number: string; join_date: string;
  avatarUrl: string | null; username: string;
};

type Panel = "menu" | "profile" | "password";

export default function AccountMenu({ name, label, canIssueAccounts, onIssueAccount, onSignOut, notify }: {
  name: string;
  label: string;
  canIssueAccounts: boolean;
  onIssueAccount: () => void;
  onSignOut: () => void;
  notify: (message: string, kind?: "success" | "info") => void;
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>("menu");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Clicking anywhere else, or pressing Escape, closes the menu.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function loadProfile() {
    try {
      const response = await fetch("/api/profile", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "تعذر تحميل الملف الشخصي");
      setProfile(payload.profile);
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر تحميل الملف الشخصي", "info");
    }
  }

  function openPanel(next: Panel) {
    setPanel(next);
    if (next === "profile" && !profile) loadProfile();
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.get("email"), phone: values.get("phone") }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "تعذر الحفظ");
      notify(payload.message);
      loadProfile();
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر الحفظ", "info");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAvatar(file: File) {
    const body = new FormData();
    body.append("avatar", file);
    setBusy(true);
    try {
      const response = await fetch("/api/profile", { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "تعذر رفع الصورة");
      setProfile((current) => current ? { ...current, avatarUrl: payload.avatarUrl } : current);
      notify(payload.message);
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر رفع الصورة", "info");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const next = String(values.get("newPassword") || "");
    if (next !== String(values.get("confirmPassword") || "")) {
      return notify("كلمتا المرور غير متطابقتين", "info");
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: values.get("currentPassword"), newPassword: next }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "تعذر تغيير كلمة المرور");
      form.reset();
      notify(payload.message);
      setPanel("menu");
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر تغيير كلمة المرور", "info");
    } finally {
      setBusy(false);
    }
  }

  const initial = name.replace("د. ", "")[0] || "ب";

  return (
    <div className="account-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen((value) => !value); setPanel("menu"); if (!profile) loadProfile(); }}
      >
        <span className="user-avatar">{profile?.avatarUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={profile.avatarUrl} alt="" />
          : initial}</span>
        <div><b>{name}</b><small>{label}</small></div>
        <i aria-hidden="true">⌄</i>
      </button>

      {open && (
        <section className="account-panel" role="menu">
          {panel === "menu" && (
            <>
              <header>
                <span className="user-avatar large">{profile?.avatarUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={profile.avatarUrl} alt="" />
                  : initial}</span>
                <div><b>{name}</b><small>{label}</small>{profile?.email && <small dir="ltr">{profile.email}</small>}</div>
              </header>
              <button type="button" onClick={() => openPanel("profile")}><span>👤</span>تعديل معلوماتي</button>
              <button type="button" onClick={() => openPanel("password")}><span>🔑</span>تغيير كلمة المرور</button>
              {canIssueAccounts && <button type="button" onClick={() => { setOpen(false); onIssueAccount(); }}><span>＋</span>إصدار حساب لموظف</button>}
              <button type="button" className="danger" onClick={() => { setOpen(false); onSignOut(); }}><span>↪</span>تسجيل الخروج</button>
            </>
          )}

          {panel === "profile" && (
            <form onSubmit={saveProfile}>
              <div className="account-panel-head"><button type="button" onClick={() => setPanel("menu")}>→</button><b>تعديل معلوماتي</b></div>
              <div className="avatar-row">
                <span className="user-avatar large">{profile?.avatarUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={profile.avatarUrl} alt="" />
                  : initial}</span>
                <div>
                  <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "جارٍ الرفع..." : "رفع صورة شخصية"}</button>
                  <small>JPG أو PNG أو WEBP · حتى 2MB</small>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadAvatar(file); event.target.value = ""; }}
                />
              </div>
              <label><span>الاسم</span><input value={profile?.full_name || name} disabled /><small>الاسم والصلاحية يعدّلهما رئيس المقيمين</small></label>
              <label><span>اسم المستخدم</span><input dir="ltr" value={profile?.username || ""} disabled /></label>
              <label><span>البريد الإلكتروني</span><input name="email" type="email" dir="ltr" defaultValue={profile?.email || ""} placeholder="name@example.com" /></label>
              <label><span>رقم الهاتف</span><input name="phone" dir="ltr" defaultValue={profile?.phone || ""} placeholder="+964 7XX XXX XXXX" /></label>
              <button className="account-save" type="submit" disabled={busy}>{busy ? "جارٍ الحفظ..." : "حفظ التعديلات"}</button>
            </form>
          )}

          {panel === "password" && (
            <form onSubmit={changePassword}>
              <div className="account-panel-head"><button type="button" onClick={() => setPanel("menu")}>→</button><b>تغيير كلمة المرور</b></div>
              <label><span>كلمة المرور الحالية</span><input name="currentPassword" type="password" dir="ltr" autoComplete="current-password" required /></label>
              <label><span>كلمة المرور الجديدة</span><input name="newPassword" type="password" dir="ltr" autoComplete="new-password" minLength={8} required /><small>8 أحرف على الأقل</small></label>
              <label><span>تأكيد كلمة المرور</span><input name="confirmPassword" type="password" dir="ltr" autoComplete="new-password" minLength={8} required /></label>
              <p className="account-note">سيتم إنهاء جلساتك على الأجهزة الأخرى بعد التغيير.</p>
              <button className="account-save" type="submit" disabled={busy}>{busy ? "جارٍ التغيير..." : "تغيير كلمة المرور"}</button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
