"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

export type WorkflowRole = "doctor" | "chief" | "accounts" | "admin" | "developer";

type Revision = {
  id: number;
  editorName: string;
  action: string;
  financialDelta: number;
  note?: string | null;
  beforeData?: Record<string, unknown> | null;
  afterData: Record<string, unknown>;
  createdAt: string;
};

type Objection = {
  id: number;
  reason: string;
  disputedAmount: number;
  status: string;
  reviewerName?: string | null;
  responseNote?: string | null;
  adjustmentAmount: number;
  submittedAt: string;
  resolvedAt?: string | null;
};

type WorkLog = {
  id: number;
  doctorName: string;
  callDate: string;
  callHours: number;
  inpatients: number;
  consultations: number;
  births: number;
  cesareans: number;
  specialCases: number;
  specialNote?: string | null;
  status: string;
  totalCalculated: number;
  totalApproved: number;
  lastEditorName?: string | null;
  updatedAt: string;
  evidence: { id: number; caseNumber: number; caseLabel?: string | null; signedUrl?: string | null }[];
  revisions: Revision[];
  deliveries: { recipientRole: string; status: string; sentAt: string }[];
  objections: Objection[];
};

const IQD = new Intl.NumberFormat("en-US");
const money = (value: number) => `${IQD.format(value)} د.ع`;
const dateFormatter = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });
const dateTimeFormatter = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const today = () => new Date().toISOString().slice(0, 10);

function numeric(value: unknown) {
  return Number(value || 0);
}

function revisionChanges(revision: Revision) {
  if (!revision.beforeData) return "أنشأ سجل المناوبة وأرسله إلى الجهات الثلاث";
  const labels: Record<string, string> = {
    callHours: "ساعات الكول",
    inpatients: "الرقود",
    consultations: "الاستشاريات",
    births: "الولادات",
    cesareans: "القيصريات",
    specialCases: "الحالات الخاصة",
  };
  const changes = Object.entries(labels).flatMap(([key, label]) => {
    const before = numeric(revision.beforeData?.[key]);
    const after = numeric(revision.afterData?.[key]);
    return before === after ? [] : [`${label}: ${IQD.format(before)} ← ${IQD.format(after)}`];
  });
  return changes.join(" · ") || revision.note || "حُدّث السجل دون تغيير الأعداد";
}

function tone(status: string) {
  if (["معتمد", "تم التدقيق", "تم الاطلاع"].includes(status)) return "approved";
  if (["مرفوض", "أُعيد للمراجعة"].includes(status)) return "returned";
  return "pending";
}

export default function ResidentWorkflow({ role, accountName, mode = "logs" }: { role: WorkflowRole; accountName: string; mode?: "logs" | "objections" }) {
  const [logs, setLogs] = useState<WorkLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<WorkLog | null>(null);
  const [consultationCount, setConsultationCount] = useState(0);
  const [objectionCall, setObjectionCall] = useState<WorkLog | null>(null);
  const [notice, setNotice] = useState<{ text: string; success: boolean } | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/work-logs", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر تحميل السجلات");
      setLogs(data.logs || []);
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "تعذر تحميل السجلات", success: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadLogs(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLogs, accountName]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const visibleLogs = useMemo(() => {
    if (mode === "objections" && role === "doctor") return logs.filter((log) => log.doctorName === accountName);
    return logs;
  }, [logs, mode, role, accountName]);
  const objections = visibleLogs.flatMap((log) => log.objections.map((item) => ({ ...item, log })));
  const mayEdit = role === "doctor" || role === "chief";

  function openNew() {
    setEditing(null);
    setConsultationCount(0);
    setEditorOpen(true);
  }

  function openEdit(log: WorkLog) {
    setEditing(log);
    setConsultationCount(log.consultations);
    setEditorOpen(true);
  }

  async function submitLog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const form = new FormData(event.currentTarget);
      form.set("doctorName", editing?.doctorName || accountName);
      form.set("editorName", accountName);
      form.set("consultations", String(consultationCount));
      const response = await fetch("/api/work-logs", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر حفظ السجل");
      setEditorOpen(false);
      setEditing(null);
      setNotice({
        text: `${editing ? "حُفظ التعديل" : "أُرسل السجل"} باسم ${accountName}، والفرق المالي ${money(Number(data.log?.financialDelta || 0))}`,
        success: true,
      });
      await loadLogs();
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "تعذر حفظ السجل", success: false });
    } finally {
      setSaving(false);
    }
  }

  async function submitObjection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!objectionCall) return;
    setSaving(true);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/objections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callId: objectionCall.id,
          doctorName: accountName,
          reason: form.get("reason"),
          disputedAmount: Number(form.get("disputedAmount")),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر إرسال الاعتراض");
      setObjectionCall(null);
      setNotice({ text: "أُرسل الاعتراض إلى رئيس المقيمين فقط وأصبح قيد المتابعة", success: true });
      await loadLogs();
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "تعذر إرسال الاعتراض", success: false });
    } finally {
      setSaving(false);
    }
  }

  async function reviewObjection(event: FormEvent<HTMLFormElement>, objectionId: number) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision = submitter?.value || "رفض";
    setSaving(true);
    try {
      const response = await fetch("/api/objections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectionId,
          reviewerName: accountName,
          decision,
          responseNote: form.get("responseNote"),
          adjustmentAmount: Number(form.get("adjustmentAmount") || 0),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر حفظ قرار الاعتراض");
      setNotice({ text: decision === "قبول" ? "تم التدقيق وإضافة الاستحقاق إلى كشف الطبيب" : "تم رفض الاعتراض مع توثيق السبب", success: true });
      await loadLogs();
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "تعذر حفظ القرار", success: false });
    } finally {
      setSaving(false);
    }
  }

  if (mode === "objections") {
    return <>
      <section className="page-title"><div><p className="eyebrow">مسار مالي موثّق</p><h1>{role === "chief" ? "اعتراضات الأطباء" : "اعتراضاتي المالية"}</h1><p>{role === "chief" ? "تصل الاعتراضات إلى رئيس المقيمين فقط، ويظهر قرار التدقيق كاملًا للطبيب." : "تابع سبب الاعتراض، القرار، والمبلغ الذي أضيف إلى كشفك عند ثبوت الاستحقاق."}</p></div><div className="title-stat"><small>اعتراضات مفتوحة</small><strong>{IQD.format(objections.filter((item) => ["مرسل", "قيد التدقيق"].includes(item.status)).length)}</strong></div></section>
      {loading ? <section className="panel workflow-loading"><span className="loading-ring" /><p>جارٍ تحميل الاعتراضات...</p></section> : objections.length ? <section className="objection-grid">{objections.map((item) => <article className="panel objection-card" key={item.id}>
        <div className="objection-head"><div><small>{item.log.doctorName} · {dateFormatter.format(new Date(`${item.log.callDate}T00:00:00`))}</small><h2>اعتراض بمبلغ {money(item.disputedAmount)}</h2></div><span className={`status ${tone(item.status)}`}><i />{item.status}</span></div>
        <p className="objection-reason">{item.reason}</p>
        {item.responseNote && <div className="review-result"><b>نتيجة التدقيق · {item.reviewerName}</b><p>{item.responseNote}</p><strong>{item.adjustmentAmount > 0 ? `أضيف ${money(item.adjustmentAmount)}` : "لم يتغير المبلغ"}</strong></div>}
        {role === "chief" && ["مرسل", "قيد التدقيق"].includes(item.status) && <form className="objection-review" onSubmit={(event) => reviewObjection(event, item.id)}><label><span>نتيجة التدقيق</span><textarea name="responseNote" required minLength={5} placeholder="اشرح القرار للطبيب بوضوح" /></label><label><span>المبلغ المستحق عند القبول</span><input name="adjustmentAmount" type="number" min="0" step="1000" defaultValue={item.disputedAmount} /></label><div><button className="secondary-action" name="decision" value="رفض" disabled={saving}>رفض مع السبب</button><button className="primary-action" name="decision" value="قبول" disabled={saving}>قبول وإضافة المبلغ</button></div></form>}
      </article>)}</section> : <section className="panel workflow-empty"><span>✓</span><div><h2>لا توجد اعتراضات حالياً</h2><p>عند إرسال اعتراض سيظهر هنا مع كامل مسار التدقيق والتسوية.</p></div></section>}
      {notice && <div className={`toast ${notice.success ? "success" : "info"}`}><span>{notice.success ? "✓" : "i"}</span>{notice.text}</div>}
    </>;
  }

  return <>
    <section className="page-title"><div><p className="eyebrow">سجل المناوبات الذكي</p><h1>أيام العمل والتعديلات</h1><p>الكولات والحالات والإثباتات والأثر المالي وسجل كل من عدّل البيانات في شاشة واحدة.</p></div>{role === "doctor" && <button className="primary-action" onClick={openNew}><b>＋</b> تسجيل مناوبة اليوم</button>}</section>
    <section className="workflow-summary">
      <article><span>▣</span><div><small>السجلات المرسلة</small><strong>{IQD.format(visibleLogs.length)}</strong></div></article>
      <article><span>⌕</span><div><small>قيد التدقيق</small><strong>{IQD.format(visibleLogs.filter((log) => log.status === "مرسل للتدقيق").length)}</strong></div></article>
      <article><span>₫</span><div><small>إجمالي الرصيد الحالي</small><strong>{money(visibleLogs.reduce((sum, log) => sum + log.totalApproved, 0))}</strong></div></article>
      <article><span>⇄</span><div><small>تعديلات موثقة</small><strong>{IQD.format(visibleLogs.reduce((sum, log) => sum + log.revisions.length, 0))}</strong></div></article>
    </section>
    {role === "doctor" && <section className="demo-notice"><span>i</span><p><b>يمكن للطبيب المناوب اللاحق استكمال سجل سابق</b><small>يظل الرصيد لصاحب السجل، بينما يظهر اسم الطبيب الذي عدّل والأرقام قبل وبعد والفرق المالي.</small></p></section>}
    {loading ? <section className="panel workflow-loading"><span className="loading-ring" /><p>جارٍ تحميل سجلات المناوبات...</p></section> : visibleLogs.length ? <section className="worklog-list">{visibleLogs.map((log) => <article className="panel worklog-card" key={log.id}>
      <div className="worklog-head"><div className="worklog-doctor"><span>{log.doctorName.replace("د. ", "")[0]}</span><div><h2>{log.doctorName}</h2><small>{dateFormatter.format(new Date(`${log.callDate}T00:00:00`))} · كول {IQD.format(log.callHours)} ساعة</small></div></div><div className="worklog-status"><span className={`status ${tone(log.status)}`}><i />{log.status}</span><small>آخر تعديل: <b>{log.lastEditorName || log.doctorName}</b></small></div></div>
      <div className="case-counts">{[["الاستشاريات", log.consultations, "◎"], ["الولادات", log.births, "◇"], ["القيصريات", log.cesareans, "＋"], ["الرقود", log.inpatients, "▣"], ["الحالات الخاصة", log.specialCases, "★"]].map(([label, value, icon]) => <div key={String(label)}><span>{icon}</span><small>{label}</small><strong>{IQD.format(Number(value))}</strong></div>)}</div>
      {log.specialNote && <div className="special-note"><b>ملاحظة الحالات الخاصة</b><p>{log.specialNote}</p></div>}
      <div className="worklog-finance"><div><small>المبلغ قبل السقوف</small><b>{money(log.totalCalculated)}</b></div><div><small>الرصيد الحالي للطبيب</small><strong>{money(log.totalApproved)}</strong></div><p><span>⌛</span> الرقود محفوظ في السجل ومعلّق حتى تؤكد الحسابات أيام الدفع.</p></div>
      {log.evidence.length > 0 && <div className="evidence-strip"><b>إثباتات الاستشاريات</b><div>{log.evidence.map((item) => item.signedUrl ? <a key={item.id} href={item.signedUrl} target="_blank" rel="noreferrer"><span>▧</span>{item.caseLabel || `الاستشارية ${item.caseNumber}`}</a> : <span key={item.id}><i>▧</i>{item.caseLabel || `الاستشارية ${item.caseNumber}`}</span>)}</div></div>}
      <div className="delivery-strip"><b>أُرسل إلى</b>{log.deliveries.map((delivery) => <span key={delivery.recipientRole}>✓ {delivery.recipientRole}</span>)}</div>
      <details className="revision-history"><summary>سجل التعديلات الكامل ({IQD.format(log.revisions.length)})</summary><div>{log.revisions.map((revision) => <article key={revision.id}><span>{revision.editorName.replace("د. ", "")[0]}</span><div><b>{revision.editorName} · {revision.action}</b><p>{revisionChanges(revision)}</p><small>{dateTimeFormatter.format(new Date(revision.createdAt))}</small></div><strong className={revision.financialDelta < 0 ? "negative" : ""}>{revision.financialDelta === 0 ? "دون فرق مالي" : `${revision.financialDelta > 0 ? "+" : ""}${money(revision.financialDelta)}`}</strong></article>)}</div></details>
      <div className="worklog-actions">{mayEdit && <button className="secondary-action" onClick={() => openEdit(log)}>تعديل السجل مع توثيق اسمي</button>}{role === "doctor" && log.doctorName === accountName && !log.objections.some((item) => ["مرسل", "قيد التدقيق"].includes(item.status)) && <button className="text-button" onClick={() => setObjectionCall(log)}>لدي اعتراض على الحساب</button>}</div>
    </article>)}</section> : <section className="panel workflow-empty"><span>＋</span><div><h2>لا توجد سجلات مناوبة بعد</h2><p>{role === "doctor" ? "ابدأ بتسجيل كول اليوم والحالات؛ سيصل تلقائياً إلى الحسابات ورئيس المقيمين والإدارة العليا." : "ستظهر السجلات فور إرسالها من الأطباء المقيمين."}</p></div>{role === "doctor" && <button className="primary-action" onClick={openNew}>تسجيل أول مناوبة</button>}</section>}

    {editorOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditorOpen(false)}><form className="entry-modal workflow-modal" key={editing?.id || "new"} onSubmit={submitLog}>
      <div className="modal-head"><div><p className="eyebrow">{editing ? `تعديل مسجل باسم ${accountName}` : "سجل طبيب مقيم جديد"}</p><h2>{editing ? `تحديث مناوبة ${editing.doctorName}` : "تسجيل مناوبة اليوم"}</h2><p>يظهر اسم منفذ التعديل في السجل الدائم، ويصل التحديث تلقائياً للجهات المعنية.</p></div><button type="button" className="close-button" onClick={() => setEditorOpen(false)}>×</button></div>
      <div className="workflow-fields"><label className="form-field"><span>اسم صاحب السجل</span><input value={editing?.doctorName || accountName} disabled /></label><label className="form-field"><span>تاريخ اليوم</span><input name="callDate" type="date" required defaultValue={editing?.callDate || today()} /></label><label className="form-field"><span>مدة الكول</span><select name="callHours" defaultValue={String(editing?.callHours || 12)}><option value="12">12 ساعة</option><option value="24">24 ساعة</option></select></label><label className="form-field"><span>عدد الرقود</span><input name="inpatients" type="number" min="0" required defaultValue={editing?.inpatients || 0} /></label><label className="form-field"><span>عدد الولادات</span><input name="births" type="number" min="0" required defaultValue={editing?.births || 0} /></label><label className="form-field"><span>عدد القيصريات</span><input name="cesareans" type="number" min="0" required defaultValue={editing?.cesareans || 0} /></label><label className="form-field"><span>عدد الحالات الخاصة</span><input name="specialCases" type="number" min="0" required defaultValue={editing?.specialCases || 0} /></label><label className="form-field"><span>عدد الاستشاريات</span><input type="number" min="0" required value={consultationCount} onChange={(event) => setConsultationCount(Math.max(0, Number(event.target.value) || 0))} /></label><label className="form-field full"><span>تفاصيل الحالات الخاصة</span><textarea name="specialNote" rows={2} defaultValue={editing?.specialNote || ""} placeholder="معلومة سريرية موجزة لا تتضمن بيانات حساسة غير لازمة" /></label></div>
      <section className="consultation-evidence-fields"><div><b>صورة لكل حالة استشارية</b><small>{editing && editing.evidence.length === consultationCount ? "يمكن إبقاء الصور الحالية دون إعادة اختيارها، أو اختيار صور جديدة لكل الحالات لاستبدالها." : `يلزم اختيار ${IQD.format(consultationCount)} صورة لإكمال الإرسال.`}</small></div>{Array.from({ length: consultationCount }, (_, index) => <div className="evidence-field" key={index}><label className="form-field"><span>وصف الاستشارية {IQD.format(index + 1)}</span><input name="consultationLabel" defaultValue={editing?.evidence[index]?.caseLabel || ""} placeholder="مثال: حالة طارئة" /></label><label className="file-field"><span>▧</span><b>{editing?.evidence[index] ? "استبدال الصورة (اختياري)" : "إرفاق صورة الإثبات"}</b><input name="consultationEvidence" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" required={!editing?.evidence[index]} /></label></div>)}</section>
      <div className="calculation-note"><span>₫</span><p><b>حساب ذكي قبل التدقيق</b><small>الاستشارية 10,000 · الولادة 80,000 · القيصرية 120,000 د.ع، مع تطبيق سقوف الطبيب. الرقود ينتظر تأكيد الحسابات.</small></p></div>
      <div className="modal-actions"><button type="button" className="secondary-action" onClick={() => setEditorOpen(false)}>إلغاء</button><button type="submit" className="primary-action" disabled={saving}>{saving ? "جارٍ الحفظ..." : editing ? "حفظ التعديل وإعادة الإرسال" : "إرسال إلى الجهات الثلاث"}</button></div>
    </form></div>}

    {objectionCall && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setObjectionCall(null)}><form className="entry-modal objection-modal" onSubmit={submitObjection}><div className="modal-head"><div><p className="eyebrow">اعتراض مالي خاص</p><h2>اعتراض على حساب {dateFormatter.format(new Date(`${objectionCall.callDate}T00:00:00`))}</h2><p>يصل الاعتراض إلى رئيس المقيمين فقط، وتظهر لك النتيجة والكشف بعد التدقيق.</p></div><button type="button" className="close-button" onClick={() => setObjectionCall(null)}>×</button></div><label className="form-field"><span>المبلغ المختلف عليه</span><input name="disputedAmount" type="number" min="1000" step="1000" required defaultValue={Math.max(1000, objectionCall.totalCalculated - objectionCall.totalApproved)} /></label><label className="form-field"><span>سبب الاعتراض بالتفصيل</span><textarea name="reason" required minLength={10} rows={5} placeholder="اذكر الحالة أو العدد الصحيح والسبب الذي يثبت الاستحقاق..." /></label><div className="modal-actions"><button type="button" className="secondary-action" onClick={() => setObjectionCall(null)}>إلغاء</button><button className="primary-action" disabled={saving}>{saving ? "جارٍ الإرسال..." : "إرسال الاعتراض"}</button></div></form></div>}
    {notice && <div className={`toast ${notice.success ? "success" : "info"}`}><span>{notice.success ? "✓" : "i"}</span>{notice.text}</div>}
  </>;
}
