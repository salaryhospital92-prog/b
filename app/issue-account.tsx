"use client";

import { FormEvent, useState } from "react";

type Employee = { id: number; full_name: string; employee_number: string; role: string; specialty: string };
type Lookup = { employee: Employee; hasAccount: boolean; loginName: string | null; lastLoginAt: string | null; active: boolean };
type Issued = { employee: Employee; login_name: string; password: string; reissued: boolean; message: string };

export default function IssueAccount({ onClose, notify }: {
  onClose: () => void;
  notify: (message: string, kind?: "success" | "info") => void;
}) {
  const [number, setNumber] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function findEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setIssued(null);
    try {
      const response = await fetch(`/api/auth/provision?employeeNumber=${encodeURIComponent(number)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "تعذر البحث");
      setLookup(payload);
    } catch (caught) {
      setLookup(null);
      setError(caught instanceof Error ? caught.message : "تعذر البحث");
    } finally {
      setBusy(false);
    }
  }

  async function issue(reissue: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeNumber: number, reissue }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "تعذر الإصدار");
      setIssued(payload);
      notify(payload.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر الإصدار");
    } finally {
      setBusy(false);
    }
  }

  function copyCredentials() {
    if (!issued) return;
    navigator.clipboard.writeText(
      `نظام البياتي\nالموظف: ${issued.employee.full_name}\nاسم المستخدم: ${issued.login_name}\nكلمة المرور: ${issued.password}\nيجب تغييرها عند أول دخول.`,
    );
    notify("نُسخت بيانات الحساب — سلّمها للموظف");
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="entry-modal issue-modal" role="dialog" aria-modal="true" aria-label="إصدار حساب موظف">
        <div className="modal-head">
          <div>
            <p className="eyebrow">إصدار حساب من النظام</p>
            <h2>حساب دخول لموظف</h2>
            <p>أدخل رقم الموظف، ويولّد النظام اسم المستخدم وكلمة مرور مؤقتة.</p>
          </div>
          <button type="button" className="close-button" aria-label="إغلاق" onClick={onClose}>×</button>
        </div>

        <form className="issue-search" onSubmit={findEmployee}>
          <label className="form-field">
            <span>رقم الموظف <b>*</b></span>
            <input dir="ltr" value={number} onChange={(event) => { setNumber(event.target.value); setError(""); }} placeholder="DEMO-DOC-001" required />
          </label>
          <button className="secondary-action" type="submit" disabled={busy || !number.trim()}>{busy ? "..." : "بحث"}</button>
        </form>

        {error && <p className="login-error" role="alert">{error}</p>}

        {lookup && !issued && (
          <>
            <div className="issue-employee">
              <span className="record-avatar employee">{lookup.employee.full_name[0]}</span>
              <p><b>{lookup.employee.full_name}</b><small>{lookup.employee.employee_number} · {lookup.employee.role} · {lookup.employee.specialty}</small></p>
              {lookup.hasAccount
                ? <i className="issue-tag warn">لديه حساب: {lookup.loginName}</i>
                : <i className="issue-tag ok">بلا حساب</i>}
            </div>
            {!lookup.active && <p className="login-error">هذا الموظف غير نشط أو غير معتمد، فلا يمكن إصدار حساب له.</p>}
            <div className="issue-actions">
              {lookup.hasAccount ? (
                <button type="button" className="primary-action" disabled={busy || !lookup.active} onClick={() => issue(true)}>
                  إصدار كلمة مرور جديدة<span>↻</span>
                </button>
              ) : (
                <button type="button" className="primary-action" disabled={busy || !lookup.active} onClick={() => issue(false)}>
                  توليد الحساب<span>⚡</span>
                </button>
              )}
            </div>
            {lookup.hasAccount && <p className="issue-note">إعادة الإصدار تُلغي كلمة المرور القديمة وتُنهي جلساته على كل الأجهزة.</p>}
          </>
        )}

        {issued && (
          <div className="issue-result">
            <div className="issue-result-head"><span>✓</span><p><b>{issued.message}</b><small>{issued.employee.full_name} · {issued.employee.employee_number}</small></p></div>
            <dl>
              <div><dt>اسم المستخدم</dt><dd dir="ltr">{issued.login_name}</dd></div>
              <div><dt>كلمة المرور المؤقتة</dt><dd dir="ltr" className="issue-password">{issued.password}</dd></div>
            </dl>
            {/* Only the hash is kept, so this is the one chance to read it. */}
            <p className="issue-warn">⚠️ كلمة المرور تظهر الآن فقط. انسخها وسلّمها للموظف — لا يمكن استعادتها لاحقًا، وسيُطلب منه تغييرها عند أول دخول.</p>
            <div className="issue-actions">
              <button type="button" className="primary-action" onClick={copyCredentials}>نسخ بيانات الحساب<span>⧉</span></button>
              <button type="button" className="secondary-action" onClick={() => { setIssued(null); setLookup(null); setNumber(""); }}>إصدار حساب آخر</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
