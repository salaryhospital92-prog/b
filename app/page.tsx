"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { buildNewbornNames, calculateDailyCompensation, getInitialPrice } from "../lib/rules-engine";

type Role = "doctor" | "chief" | "accounts" | "admin";
type View = "overview" | "handover" | "days" | "audit" | "payments" | "reports" | "settings" | "registry" | "personalSalary";
type Toast = { message: string; kind: "success" | "info" } | null;
type PatientRecord = { id: number; fullName: string; fileNumber: string; department: string; admissionDate: string; paymentCategory: string; entryType: string; patientStatus: string; billingMode: string; attendingDoctor?: string | null; isNewborn?: boolean; newbornCount?: number };
type EmployeeRecord = { id: number; fullName: string; employeeNumber: string; role: string; specialty: string; status: string };
type HandoverPatient = { id: number; priority: string; clinicalSummary: string; pendingActions: string; receivedStatus: string; patient: PatientRecord };
type HandoverRecord = { id: number; fromDoctorName: string; toDoctorName: string; status: string; notes?: string | null; shiftEndedAt: string; acceptedAt?: string | null; patients: HandoverPatient[] };

const IQD = new Intl.NumberFormat("en-US");
const money = (value: number) => `${IQD.format(value)} د.ع`;

const recentDays = [
  { id: 1, day: "الأحد", date: "10 آب 2026", status: "معتمد", amount: 245000, tone: "approved", details: "8 استشاريات · ولادة طبيعية · 3 حالات رقود" },
  { id: 2, day: "السبت", date: "9 آب 2026", status: "تدشيك الراتب", amount: 190000, tone: "pending", details: "6 استشاريات · عملية قيصرية" },
  { id: 3, day: "الخميس", date: "7 آب 2026", status: "معتمد", amount: 220000, tone: "approved", details: "10 استشاريات · حالتا رقود" },
  { id: 4, day: "الأربعاء", date: "6 آب 2026", status: "أُعيد للمراجعة", amount: 125000, tone: "returned", details: "5 استشاريات · إثبات ناقص" },
];

const auditSeed = [
  { id: 1, doctor: "د. سارة محمود", avatar: "س", date: "10 آب 2026", procedures: "12 استشارية · 2 ولادة", entered: 285000, cap: 250000, over: true, wait: "منذ 18 دقيقة" },
  { id: 2, doctor: "د. أحمد البياتي", avatar: "أ", date: "10 آب 2026", procedures: "8 استشاريات · 3 رقود", entered: 245000, cap: 250000, over: false, wait: "منذ 42 دقيقة" },
  { id: 3, doctor: "د. مريم حسن", avatar: "م", date: "9 آب 2026", procedures: "6 استشاريات · 1 قيصرية", entered: 190000, cap: 200000, over: false, wait: "منذ ساعتين" },
  { id: 4, doctor: "د. يوسف كريم", avatar: "ي", date: "9 آب 2026", procedures: "15 استشارية", entered: 150000, cap: 200000, over: true, wait: "منذ 3 ساعات" },
];

const paymentSeed = [
  { id: 1, patient: "زينب علي", file: "P-1048", admission: "8 آب", days: ["paid", "paid", "pending", "none", "none"] },
  { id: 2, patient: "هدى فاضل", file: "P-1045", admission: "7 آب", days: ["free", "free", "none", "none", "none"] },
  { id: 3, patient: "نور جاسم", file: "P-1039", admission: "6 آب", days: ["paid", "paid", "paid", "paid", "none"] },
  { id: 4, patient: "رنا كامل", file: "P-1032", admission: "5 آب", days: ["pending", "pending", "pending", "none", "none"] },
];

const roles: { id: Role; label: string; name: string }[] = [
  { id: "doctor", label: "الطبيب المقيم", name: "د. أحمد البياتي" },
  { id: "chief", label: "رئيس الأطباء", name: "د. ليلى قاسم" },
  { id: "accounts", label: "قسم الحسابات", name: "سلمى نزار" },
  { id: "admin", label: "الإدارة العليا", name: "أ. عمر عدنان" },
];

function Icon({ children }: { children: string }) {
  return <span className="nav-icon" aria-hidden="true">{children}</span>;
}

function Sparkline() {
  const bars = [42, 56, 38, 68, 52, 76, 64, 86, 72, 92, 78, 96];
  return (
    <div className="sparkline" aria-label="نمو الراتب خلال الشهر">
      {bars.map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}
    </div>
  );
}

function StatusPill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`status ${tone}`}><i />{children}</span>;
}

export default function Home() {
  const [role, setRole] = useState<Role>("doctor");
  const [view, setView] = useState<View>("overview");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [auditRows, setAuditRows] = useState(auditSeed);
  const [payments, setPayments] = useState(paymentSeed);
  const [addOpen, setAddOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [consultations, setConsultations] = useState(8);
  const [births, setBirths] = useState(1);
  const [cesareans, setCesareans] = useState(0);
  const [inpatients, setInpatients] = useState(3);
  const [auditFilter, setAuditFilter] = useState("الكل");
  const [search, setSearch] = useState("");
  const [registryTab, setRegistryTab] = useState<"patient" | "employee">("patient");
  const [registrySaving, setRegistrySaving] = useState(false);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [registeredPatients, setRegisteredPatients] = useState<PatientRecord[]>([]);
  const [registeredEmployees, setRegisteredEmployees] = useState<EmployeeRecord[]>([]);
  const [employeeRole, setEmployeeRole] = useState("طبيب مقيم");
  const [patientName, setPatientName] = useState("");
  const [patientEntryType, setPatientEntryType] = useState("استشارية");
  const [newbornCount, setNewbornCount] = useState(0);
  const [patientInitialPrice, setPatientInitialPrice] = useState(getInitialPrice("استشارية"));
  const [handoverLoading, setHandoverLoading] = useState(true);
  const [handoverSaving, setHandoverSaving] = useState(false);
  const [handover, setHandover] = useState<HandoverRecord | null>(null);
  const [handoverCandidates, setHandoverCandidates] = useState<PatientRecord[]>([]);
  const [selectedPatientIds, setSelectedPatientIds] = useState<number[]>([]);
  const [handoverFromDoctor, setHandoverFromDoctor] = useState("د. سارة محمود");
  const [handoverToDoctor, setHandoverToDoctor] = useState("د. أحمد البياتي");

  const currentRole = roles.find((item) => item.id === role)!;
  const dailyCalculation = calculateDailyCompensation({ consultations, births, cesareans, paidInpatients: inpatients, maxConsultations: 10, combinedCap: 200000 });
  const capDiscount = dailyCalculation.capDiscount;
  const estimatedTotal = dailyCalculation.approvedTotal;
  const newbornNames = buildNewbornNames(patientName, newbornCount);

  const navItems = useMemo(() => {
    if (role === "doctor") return [
      { id: "overview" as View, label: "الرئيسية", icon: "⌂" },
      { id: "handover" as View, label: "استلام المناوبة", icon: "⇄" },
      { id: "days" as View, label: "أيام العمل", icon: "▣" },
      { id: "reports" as View, label: "كشف الحساب", icon: "≋" },
    ];
    if (role === "chief") return [
      { id: "overview" as View, label: "الرئيسية", icon: "⌂" },
      { id: "handover" as View, label: "تسليم المناوبات", icon: "⇄" },
      { id: "personalSalary" as View, label: "راتبي الشخصي", icon: "◇" },
      { id: "audit" as View, label: "التدقيق والاعتماد", icon: "✓" },
      { id: "settings" as View, label: "سقوف الأطباء", icon: "⌁" },
      { id: "reports" as View, label: "التقارير", icon: "≋" },
    ];
    if (role === "accounts") return [
      { id: "overview" as View, label: "الرئيسية", icon: "⌂" },
      { id: "registry" as View, label: "تسجيل مريض", icon: "＋" },
      { id: "payments" as View, label: "حالات الدفع", icon: "◫" },
      { id: "reports" as View, label: "المطابقات", icon: "≋" },
    ];
    return [
      { id: "overview" as View, label: "لوحة القيادة", icon: "⌂" },
      { id: "registry" as View, label: "مركز التسجيل", icon: "＋" },
      { id: "reports" as View, label: "التقارير الشاملة", icon: "≋" },
      { id: "payments" as View, label: "البحث عن مريض", icon: "⌕" },
      { id: "settings" as View, label: "إدارة النظام", icon: "⌁" },
    ];
  }, [role]);

  useEffect(() => {
    if (view !== "registry") return;
    let active = true;
    fetch("/api/registry")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "تعذر تحميل سجلات التسجيل");
        if (active) {
          setRegisteredPatients(data.patients ?? []);
          setRegisteredEmployees(data.employees ?? []);
        }
      })
      .catch(() => {
        if (active) notify("سيتم عرض السجلات فور اكتمال تهيئة قاعدة البيانات", "info");
      })
      .finally(() => active && setRegistryLoading(false));
    return () => { active = false; };
  }, [view]);

  useEffect(() => {
    if (view !== "handover") return;
    let active = true;
    fetch("/api/handover")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "تعذر تحميل تسليم المناوبة");
        if (active) {
          setHandover(data.handover ?? null);
          setHandoverCandidates(data.candidates ?? []);
          setSelectedPatientIds((data.candidates ?? []).map((patient: PatientRecord) => patient.id));
        }
      })
      .catch(() => active && notify("تعذر تحميل المناوبة الآن، حاول مرة أخرى", "info"))
      .finally(() => active && setHandoverLoading(false));
    return () => { active = false; };
  }, [view]);

  function changeRole(nextRole: Role) {
    setRole(nextRole);
    setView("overview");
    setSidebarExpanded(false);
  }

  function navigateTo(nextView: View) {
    setView(nextView);
    setSidebarExpanded(false);
  }

  function notify(message: string, kind: "success" | "info" = "success") {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 3000);
  }

  function approveAudit(id: number) {
    const item = auditRows.find((row) => row.id === id);
    setAuditRows((rows) => rows.filter((row) => row.id !== id));
    notify(`تم اعتماد يوم ${item?.doctor} وظهر المبلغ النهائي في حسابه`);
  }

  function cyclePayment(patientId: number, dayIndex: number) {
    const cycle: Record<string, string> = { paid: "pending", pending: "free", free: "paid", none: "paid" };
    setPayments((rows) => rows.map((row) => row.id === patientId
      ? { ...row, days: row.days.map((status, index) => index === dayIndex ? cycle[status] : status) }
      : row));
    notify("تم تحديث حالة الدفع وإعادة احتساب حصة الرقود", "info");
  }

  function submitDay(event: FormEvent) {
    event.preventDefault();
    setAddOpen(false);
    notify("حُفظ يوم العمل وظهر تلقائيًا بحالة تدشيك الراتب");
  }

  async function submitRegistry(event: FormEvent<HTMLFormElement>, kind: "patient" | "employee") {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    setRegistrySaving(true);
    try {
      const response = await fetch("/api/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ...payload }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر حفظ السجل");
      if (kind === "patient") {
        setRegisteredPatients((rows) => [data.record, ...rows]);
        notify(`تم إنشاء ملف المريض ${data.record.fullName} بنجاح`);
      } else {
        setRegisteredEmployees((rows) => [data.record, ...rows]);
        notify(`تم تسجيل الموظف ${data.record.fullName} وتحديد صلاحياته`);
      }
      form.reset();
      setEmployeeRole("طبيب مقيم");
      if (kind === "patient") {
        setPatientName("");
        setPatientEntryType("استشارية");
        setNewbornCount(0);
        setPatientInitialPrice(getInitialPrice("استشارية"));
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر حفظ السجل", "info");
    } finally {
      setRegistrySaving(false);
    }
  }

  async function updatePatientLifecycle(patientId: number, action: "convert_to_inpatient" | "discharge") {
    try {
      const response = await fetch("/api/registry", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر تحديث مسار المريضة");
      setRegisteredPatients((rows) => rows.map((item) => item.id === patientId ? { ...item, ...data.patient } : item));
      notify(data.message);
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر تحديث مسار المريضة", "info");
    }
  }

  function applyHandoverData(data: { handover?: HandoverRecord | null; candidates?: PatientRecord[] }) {
    setHandover(data.handover ?? null);
    setHandoverCandidates(data.candidates ?? []);
    setSelectedPatientIds((current) => current.filter((id) => (data.candidates ?? []).some((patient) => patient.id === id)));
  }

  function toggleHandoverPatient(patientId: number) {
    setSelectedPatientIds((ids) => ids.includes(patientId) ? ids.filter((id) => id !== patientId) : [...ids, patientId]);
  }

  async function createHandover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setHandoverSaving(true);
    try {
      const response = await fetch("/api/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          fromDoctor: handoverFromDoctor,
          toDoctor: handoverToDoctor,
          patientIds: selectedPatientIds,
          notes: formData.get("notes"),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر إنشاء تسليم المناوبة");
      applyHandoverData(data);
      notify(`أُرسلت متابعة ${selectedPatientIds.length} مريضًا إلى ${handoverToDoctor}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر إنشاء تسليم المناوبة", "info");
    } finally {
      setHandoverSaving(false);
    }
  }

  async function acceptHandover() {
    if (!handover) return;
    setHandoverSaving(true);
    try {
      const response = await fetch("/api/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", handoverId: handover.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر تأكيد استلام المناوبة");
      applyHandoverData(data);
      notify("تم استلام المرضى وانتقلت مسؤولية المتابعة إلى الطبيب الجديد");
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر تأكيد استلام المناوبة", "info");
    } finally {
      setHandoverSaving(false);
    }
  }

  function renderDoctorDashboard() {
    return (
      <>
        <section className="welcome-row">
          <div>
            <p className="eyebrow">الثلاثاء، 11 آب 2026</p>
            <h1>صباح الخير، د. أحمد</h1>
            <p className="muted">هذا ملخص عملك وحساباتك حتى الآن.</p>
          </div>
          <button className="primary-action" onClick={() => setAddOpen(true)}><b>＋</b> تسجيل يوم عمل</button>
        </section>

        <section className="doctor-grid">
          <article className="earnings-card">
            <div className="earnings-head">
              <div>
                <span>راتب آب الحالي</span>
                <strong>{money(2845000)}</strong>
              </div>
              <span className="growth">↑ 12.4%</span>
            </div>
            <Sparkline />
            <div className="earnings-foot">
              <span>مقارنة بالشهر الماضي</span>
              <b>{money(2530000)}</b>
            </div>
          </article>

          <div className="metric-stack">
            <article className="metric-card teal">
              <div className="metric-icon">⌁</div>
              <div><span>الاستشاريات</span><strong>{money(1040000)}</strong><small>104 استشاريات معتمدة</small></div>
            </article>
            <article className="metric-card sand">
              <div className="metric-icon">✦</div>
              <div><span>العمليات والرقود</span><strong>{money(1805000)}</strong><small>18 عملية · 24 حالة رقود</small></div>
            </article>
          </div>
        </section>

        <section className="content-grid">
          <article className="panel recent-panel">
            <div className="panel-head">
              <div><h2>أيام العمل الأخيرة</h2><p>آخر الإدخالات وحالة اعتمادها</p></div>
              <button className="text-button" onClick={() => setView("days")}>عرض الكل ←</button>
            </div>
            <div className="day-list">
              {recentDays.map((item) => (
                <button className="day-row" key={item.id} onClick={() => setDetailOpen(true)}>
                  <span className="date-tile"><b>{item.date.split(" ")[0]}</b><small>آب</small></span>
                  <span className="day-copy"><b>{item.day}</b><small>{item.details}</small></span>
                  <StatusPill tone={item.tone}>{item.status}</StatusPill>
                  <strong className="row-amount">{money(item.amount)}</strong>
                  <span className="chevron">‹</span>
                </button>
              ))}
            </div>
          </article>

          <aside className="assistant-card">
            <div className="assistant-title"><span className="ai-orb">✦</span><div><b>مساعد البياتي</b><small>تحليل ذكي لحساباتك</small></div><i>مباشر</i></div>
            <div className="assistant-message">
              <p>أداؤك هذا الشهر أعلى من متوسط آخر 3 أشهر.</p>
              <strong>أنت قريب من تحقيق أعلى راتب شهري لك.</strong>
            </div>
            <div className="smart-tip">
              <span>!</span>
              <p><b>تنبيه مهم</b> لديك يوم عمل أُعيد بسبب نقص صورة إثبات واحدة.</p>
            </div>
            <button className="assistant-link" onClick={() => setDetailOpen(true)}>مراجعة اليوم الآن <span>←</span></button>
          </aside>
        </section>
      </>
    );
  }

  function renderChiefDashboard() {
    return (
      <>
        <section className="welcome-row">
          <div><p className="eyebrow">مركز التدقيق الطبي</p><h1>صباح الخير، د. ليلى</h1><p className="muted">لديك {auditRows.length} أيام عمل بانتظار القرار.</p></div>
          <button className="primary-action" onClick={() => setView("audit")}>فتح قائمة التدقيق <span>←</span></button>
        </section>
        <section className="stat-row">
          <article><span className="stat-symbol amber">⌛</span><div><small>بانتظار التدقيق</small><strong>{auditRows.length}</strong><em>يومان يتطلبان الانتباه</em></div></article>
          <article><span className="stat-symbol green">✓</span><div><small>تم اعتمادها اليوم</small><strong>12</strong><em>بقيمة {money(2710000)}</em></div></article>
          <article><span className="stat-symbol red">↑</span><div><small>تجاوزات السقف</small><strong>3</strong><em>عولجت تلقائيًا</em></div></article>
          <article><span className="stat-symbol blue">◷</span><div><small>متوسط وقت التدقيق</small><strong>34 د</strong><em>أسرع بـ 8 دقائق</em></div></article>
        </section>
        <section className="content-grid wide-main">
          <article className="panel">
            <div className="panel-head"><div><h2>بحاجة إلى قرارك</h2><p>مرتبة حسب الأولوية ووقت الانتظار</p></div><button className="text-button" onClick={() => setView("audit")}>كل الطلبات ←</button></div>
            <div className="audit-mini-list">
              {auditRows.slice(0, 3).map((row) => (
                <div className="audit-mini" key={row.id}>
                  <span className="doctor-avatar">{row.avatar}</span>
                  <div><b>{row.doctor}</b><small>{row.date} · {row.procedures}</small></div>
                  {row.over ? <StatusPill tone="returned">تجاوز السقف</StatusPill> : <StatusPill tone="pending">بانتظارك</StatusPill>}
                  <strong>{money(row.entered)}</strong>
                  <button onClick={() => approveAudit(row.id)}>اعتماد</button>
                </div>
              ))}
            </div>
          </article>
          <aside className="assistant-card chief-assistant">
            <div className="assistant-title"><span className="ai-orb">✦</span><div><b>ملخص التدقيق الذكي</b><small>ما يستحق انتباهك اليوم</small></div></div>
            <div className="insight-number"><b>2</b><span>طلبان بهما تجاوزات<br />عالجها النظام تلقائيًا</span></div>
            <p className="assistant-note">الطلب الأقدم ينتظر منذ 3 ساعات. يُنصح بمراجعته أولًا للحفاظ على سرعة دورة الاعتماد.</p>
            <button className="assistant-link" onClick={() => setView("audit")}>ابدأ بالأولوية الأعلى <span>←</span></button>
          </aside>
        </section>
      </>
    );
  }

  function renderPersonalSalary() {
    return (
      <>
        <section className="page-title"><div><p className="eyebrow">حساب رئيس الأطباء كطبيب</p><h1>راتبي الشخصي</h1><p>تفاصيل أجرك منفصلة تمامًا عن صلاحيات التدقيق والاعتماد.</p></div><StatusPill tone="pending">تدشيك الراتب</StatusPill></section>
        <section className="doctor-grid">
          <article className="earnings-card"><div className="earnings-head"><div><span>راتب آب الحالي</span><strong>{money(3215000)}</strong></div><span className="growth">↑ 9.8%</span></div><Sparkline /><div className="earnings-foot"><span>من 1 إلى 11 آب</span><b>7 أيام عمل معتمدة</b></div></article>
          <div className="metric-stack"><article className="metric-card teal"><div className="metric-icon">⌁</div><div><span>الاستشاريات</span><strong>{money(1150000)}</strong><small>115 استشارية معتمدة</small></div></article><article className="metric-card sand"><div className="metric-icon">✦</div><div><span>القيصريات والرقود</span><strong>{money(2065000)}</strong><small>بعد تطبيق السقف اليومي</small></div></article></div>
        </section>
        <section className="panel recent-panel"><div className="panel-head"><div><h2>أيام عملي الأخيرة</h2><p>يمكنك فتح أي Call والاطلاع على احتسابه بالتفصيل</p></div><span className="ai-tag">لا تؤثر صلاحيات التدقيق على هذا الحساب</span></div><div className="day-list">{recentDays.slice(0, 3).map((item) => <button className="day-row" key={item.id} onClick={() => setDetailOpen(true)}><span className="date-tile"><b>{item.date.split(" ")[0]}</b><small>آب</small></span><span className="day-copy"><b>{item.day}</b><small>{item.details}</small></span><StatusPill tone={item.tone}>{item.status}</StatusPill><strong className="row-amount">{money(item.amount)}</strong><span className="chevron">‹</span></button>)}</div></section>
      </>
    );
  }

  function renderAccountsDashboard() {
    return (
      <>
        <section className="welcome-row"><div><p className="eyebrow">المركز المالي</p><h1>صباح الخير، سلمى</h1><p className="muted">حالة المطابقة والدفع محدثة حتى قبل 6 دقائق.</p></div><button className="primary-action" onClick={() => setView("payments")}>إدارة حالات الدفع <span>←</span></button></section>
        <section className="stat-row">
          <article><span className="stat-symbol green">✓</span><div><small>دفعات مؤكدة اليوم</small><strong>{money(4820000)}</strong><em>38 يوم رقود</em></div></article>
          <article><span className="stat-symbol amber">⌛</span><div><small>بانتظار التحصيل</small><strong>{money(1380000)}</strong><em>11 يوم رقود</em></div></article>
          <article><span className="stat-symbol blue">↻</span><div><small>دفعات متأخرة عولجت</small><strong>7</strong><em>أعيد توزيعها تلقائيًا</em></div></article>
          <article><span className="stat-symbol red">!</span><div><small>تحتاج مطابقة</small><strong>3</strong><em>حالات غير مكتملة</em></div></article>
        </section>
        <section className="content-grid wide-main">
          <article className="panel"><div className="panel-head"><div><h2>آخر تغييرات الدفع</h2><p>أثر كل تحديث على حسابات الأطباء</p></div><button className="text-button" onClick={() => setView("payments")}>فتح السجل ←</button></div>
            <div className="activity-list">
              <div><span className="activity-mark green">✓</span><p><b>تم تحصيل دفعة زينب علي</b><small>أضيفت حصة الرقود إلى طبيبين مقيمين · قبل 6 دقائق</small></p><strong>+{money(75000)}</strong></div>
              <div><span className="activity-mark blue">↻</span><p><b>معالجة دفعة متأخرة لنور جاسم</b><small>أعيد احتساب أيام 6–9 آب · قبل 28 دقيقة</small></p><strong>+{money(120000)}</strong></div>
              <div><span className="activity-mark amber">⌛</span><p><b>حالة رنا كامل ما زالت معلقة</b><small>3 أيام رقود دون تسوية · منذ ساعتين</small></p><strong>{money(90000)}</strong></div>
            </div>
          </article>
          <aside className="assistant-card"><div className="assistant-title"><span className="ai-orb">✦</span><div><b>مراقب المطابقة</b><small>فحص آلي للتناقضات</small></div><i>مباشر</i></div><div className="assistant-message"><p>لا توجد ازدواجية في الدفعات اليوم.</p><strong>96% من سجلات الرقود مطابقة.</strong></div><div className="smart-tip"><span>!</span><p><b>3 حالات بحاجة للتحقق</b> تواريخ الخروج غير مسجلة بعد.</p></div><button className="assistant-link" onClick={() => setView("payments")}>عرض الحالات <span>←</span></button></aside>
        </section>
      </>
    );
  }

  function renderAdminDashboard() {
    const chart = [45, 58, 52, 72, 64, 83, 76, 94];
    return (
      <>
        <section className="welcome-row"><div><p className="eyebrow">نظرة تنفيذية · آب 2026</p><h1>لوحة قيادة مستشفى البياتي</h1><p className="muted">ملخص لحظي للأداء الطبي والمالي.</p></div><button className="secondary-action" onClick={() => notify("تم تجهيز تقرير الإدارة لشهر آب")}>⇩ تصدير الملخص</button></section>
        <section className="stat-row executive">
          <article><span className="stat-symbol green">↗</span><div><small>إجمالي العوائد</small><strong>{money(48650000)}</strong><em>↑ 8.7% عن تموز</em></div></article>
          <article><span className="stat-symbol blue">♙</span><div><small>المرضى هذا الشهر</small><strong>342</strong><em>معدل إشغال 81%</em></div></article>
          <article><span className="stat-symbol amber">✦</span><div><small>مستحقات الأطباء</small><strong>{money(18240000)}</strong><em>24 طبيبًا مقيمًا</em></div></article>
          <article><span className="stat-symbol red">⌛</span><div><small>ذمم قيد التحصيل</small><strong>{money(3980000)}</strong><em>انخفضت 4.2%</em></div></article>
        </section>
        <section className="content-grid admin-grid">
          <article className="panel chart-panel"><div className="panel-head"><div><h2>اتجاه العوائد</h2><p>آخر 8 أشهر · بالمليون دينار</p></div><StatusPill tone="approved">نمو مستقر</StatusPill></div>
            <div className="bar-chart">{chart.map((height, i) => <div key={i}><span style={{ height: `${height}%` }}><i>{Math.round(height / 2)}</i></span><small>{["ك2", "ش", "آذ", "ن", "أي", "ح", "ت", "آب"][i]}</small></div>)}</div>
          </article>
          <aside className="panel mix-panel"><div className="panel-head"><div><h2>توزيع الإجراءات</h2><p>1–11 آب</p></div></div><div className="donut" aria-label="توزيع الإجراءات"><div><strong>488</strong><small>إجراء</small></div></div><ul className="legend"><li><i className="teal-dot" />استشاريات <b>62%</b></li><li><i className="orange-dot" />عمليات <b>23%</b></li><li><i className="sand-dot" />رقود <b>15%</b></li></ul></aside>
        </section>
        <section className="panel admin-alerts"><div className="panel-head"><div><h2>مؤشرات تحتاج متابعة</h2><p>يرتبها مساعد البياتي حسب الأثر المالي</p></div><span className="ai-tag">✦ تحليل ذكي</span></div><div className="alert-grid"><div><span className="stat-symbol red">!</span><p><b>3 حالات دفع غير مكتملة</b><small>قد تؤخر توزيع {money(270000)} من أجور الرقود.</small></p><button onClick={() => setView("payments")}>متابعة ←</button></div><div><span className="stat-symbol amber">↑</span><p><b>ارتفاع القيصريات 14%</b><small>مقارنة بمتوسط الأشهر الثلاثة الماضية.</small></p><button onClick={() => setView("reports")}>التفاصيل ←</button></div></div></section>
      </>
    );
  }

  function renderAudit() {
    const visible = auditRows.filter((row) => auditFilter === "الكل" || (auditFilter === "تجاوزات" ? row.over : !row.over));
    return (
      <>
        <section className="page-title"><div><p className="eyebrow">رئيس الأطباء</p><h1>التدقيق والاعتماد</h1><p>راجع إدخالات الأطباء واتخذ القرار النهائي.</p></div><div className="title-stat"><small>بانتظارك</small><strong>{auditRows.length}</strong></div></section>
        <section className="panel table-panel">
          <div className="toolbar"><div className="filters">{["الكل", "ضمن السقف", "تجاوزات"].map((item) => <button className={auditFilter === item ? "active" : ""} onClick={() => setAuditFilter(item)} key={item}>{item}</button>)}</div><label className="table-search"><span>⌕</span><input placeholder="ابحث باسم الطبيب..." /></label></div>
          <div className="data-table audit-table">
            <div className="table-header"><span>الطبيب واليوم</span><span>الإجراءات</span><span>المبلغ المدخل</span><span>فحص النظام</span><span>القرار</span></div>
            {visible.map((row) => <div className="table-row" key={row.id}><span className="doctor-cell"><i className="doctor-avatar">{row.avatar}</i><span><b>{row.doctor}</b><small>{row.date} · {row.wait}</small></span></span><span>{row.procedures}</span><strong>{money(row.entered)}</strong><span>{row.over ? <StatusPill tone="returned">يتجاوز السقف</StatusPill> : <StatusPill tone="approved">سليم</StatusPill>}</span><span className="row-actions"><button className="approve-button" onClick={() => approveAudit(row.id)}>اعتماد</button><button className="more-button" aria-label="خيارات أخرى">•••</button></span></div>)}
            {visible.length === 0 && <div className="empty-state"><span>✓</span><h3>أُنجزت هذه القائمة</h3><p>لا توجد طلبات مطابقة لهذا المرشح.</p></div>}
          </div>
        </section>
      </>
    );
  }

  function renderPayments() {
    const filtered = payments.filter((row) => row.patient.includes(search) || row.file.toLowerCase().includes(search.toLowerCase()));
    return (
      <>
        <section className="page-title"><div><p className="eyebrow">قسم الحسابات</p><h1>{role === "admin" ? "البحث وتتبع المرضى" : "إدارة حالات الدفع"}</h1><p>غيّر الحالة بالضغط على الخلية؛ يعيد النظام توزيع الحصص تلقائيًا.</p></div><button className="secondary-action" onClick={() => notify("تمت مطابقة الدفعات مع جميع أيام العمل")}>↻ مطابقة الكل</button></section>
        <section className="payment-summary"><div><i className="paid-dot" /><span><b>مدفوع</b><small>يُحتسب ضمن الأجور</small></span></div><div><i className="pending-dot" /><span><b>ليس بعد</b><small>بانتظار التحصيل</small></span></div><div><i className="free-dot" /><span><b>مجاني</b><small>لا يدخل في الأجر</small></span></div><label className="table-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="اسم المريض أو رقم الملف" /></label></section>
        <section className="panel table-panel payment-panel">
          <div className="payment-table">
            <div className="payment-row payment-head"><span>المريض</span><span>الدخول</span>{["6 آب", "7 آب", "8 آب", "9 آب", "10 آب"].map((day) => <span key={day}>{day}</span>)}<span>الإجمالي</span></div>
            {filtered.map((row) => <div className="payment-row" key={row.id}><span className="patient-name"><i>{row.patient[0]}</i><span><b>{row.patient}</b><small>{row.file}</small></span></span><span>{row.admission}</span>{row.days.map((status, index) => <button key={index} className={`payment-cell ${status}`} onClick={() => cyclePayment(row.id, index)} aria-label={`تغيير حالة دفع ${row.patient} ليوم ${index + 6}`}>{status === "paid" ? "✓ مدفوع" : status === "pending" ? "⌛ ليس بعد" : status === "free" ? "— مجاني" : "·"}</button>)}<strong>{money(row.days.filter((d) => d === "paid").length * 30000)}</strong></div>)}
          </div>
        </section>
      </>
    );
  }

  function renderRegistry() {
    const activeTab = role === "accounts" ? "patient" : registryTab;
    const latest = activeTab === "patient" ? registeredPatients : registeredEmployees;
    const isDoctorRole = employeeRole === "طبيب مقيم" || employeeRole === "رئيس الأطباء";
    return (
      <>
        <section className="page-title registry-title">
          <div>
            <p className="eyebrow">قاعدة البيانات المركزية</p>
            <h1>مركز التسجيل</h1>
            <p>أنشئ ملفات المرضى وحسابات الموظفين مع تدقيق البيانات قبل الحفظ.</p>
          </div>
          <div className="registry-health"><span>✓</span><p><b>الحفظ الآمن مفعّل</b><small>تُحفظ السجلات مباشرة في قاعدة النظام</small></p></div>
        </section>

        <section className="registry-stats">
          <article><span className="registry-stat-icon patient">♙</span><div><small>المرضى المسجلون حديثًا</small><strong>{registeredPatients.length}</strong><em>آخر 12 سجلًا</em></div></article>
          <article><span className="registry-stat-icon employee">✦</span><div><small>الموظفون النشطون</small><strong>{registeredEmployees.filter((item) => item.status === "نشط").length}</strong><em>حسب الدور والاختصاص</em></div></article>
          <article><span className="registry-stat-icon quality">✓</span><div><small>اكتمال بيانات اليوم</small><strong>100%</strong><em>لا توجد سجلات ناقصة</em></div></article>
        </section>

        <section className="registry-layout">
          <aside className="registry-menu">
            <p>نوع التسجيل</p>
            <button className={activeTab === "patient" ? "active" : ""} onClick={() => setRegistryTab("patient")}>
              <span>♙</span><div><b>تسجيل مريض</b><small>الملف الطبي وبيانات الدخول</small></div><i>←</i>
            </button>
            {role === "admin" && <button className={activeTab === "employee" ? "active" : ""} onClick={() => setRegistryTab("employee")}>
              <span>✦</span><div><b>تسجيل موظف</b><small>الدور والاختصاص والصلاحيات</small></div><i>←</i>
            </button>}
            <div className="registry-tip"><span className="ai-orb">✦</span><p><b>مساعد التسجيل</b><small>{activeTab === "patient" ? "يتحقق من رقم الملف والحقول الأساسية قبل إنشاء سجل المريض." : "يضبط سقوف الأطباء تلقائيًا حسب الدور المختار."}</small></p></div>
          </aside>

          <div className="registry-main">
            {activeTab === "patient" ? (
              <form className="registry-form" onSubmit={(event) => submitRegistry(event, "patient")}>
                <div className="registry-form-head"><div><span>♙</span><p><b>بيانات المريض</b><small>الحقول المعلّمة مطلوبة لإنشاء الملف</small></p></div><StatusPill tone="approved">نموذج جديد</StatusPill></div>
                <div className="form-section-title"><span>1</span><div><b>المعلومات الأساسية</b><small>الهوية ووسائل التواصل</small></div></div>
                <div className="registry-fields">
                  <label className="form-field wide"><span>الاسم الثلاثي للمريضة <b>*</b></span><input name="fullName" required value={patientName} onChange={(event) => setPatientName(event.target.value)} placeholder="مثال: زهراء علي خلف" /></label>
                  <label className="form-field"><span>رقم الملف <b>*</b></span><input name="fileNumber" required defaultValue={`P-${1050 + registeredPatients.length}`} dir="ltr" /></label>
                  <label className="form-field"><span>تاريخ الميلاد</span><input name="birthDate" type="date" /></label>
                  <label className="form-field"><span>الجنس <b>*</b></span><select name="gender" required defaultValue="أنثى"><option>أنثى</option><option>ذكر</option></select></label>
                  <label className="form-field"><span>رقم الهاتف</span><input name="phone" type="tel" placeholder="07XX XXX XXXX" dir="ltr" /></label>
                </div>
                <div className="form-section-title"><span>2</span><div><b>بيانات الدخول</b><small>القسم والطبيب وتصنيف الدفع</small></div></div>
                <div className="registry-fields">
                  <label className="form-field"><span>تاريخ الدخول <b>*</b></span><input name="admissionDate" type="date" required defaultValue="2026-08-11" /></label>
                  <label className="form-field"><span>نوع الدخول <b>*</b></span><select name="entryType" required value={patientEntryType} onChange={(event) => { setPatientEntryType(event.target.value); setPatientInitialPrice(getInitialPrice(event.target.value)); if (!event.target.value.includes("ولادة") && !event.target.value.includes("قيصرية")) setNewbornCount(0); }}><option>استشارية</option><option>رقود</option><option>ولادة طبيعية</option><option>عملية قيصرية</option></select></label>
                  <label className="form-field"><span>{patientEntryType === "رقود" ? "تسعيرة يوم الرقود" : "التسعيرة الأولية"} (د.ع)</span><input name="initialPrice" type="number" min="0" step="1000" value={patientInitialPrice} onChange={(event) => setPatientInitialPrice(Number(event.target.value))} /></label>
                  <label className="form-field"><span>القسم الطبي <b>*</b></span><select name="department" required defaultValue=""><option value="" disabled>اختر القسم</option><option>النسائية والتوليد</option><option>الجراحة العامة</option><option>الطب الباطني</option><option>طب الأطفال</option><option>الطوارئ</option><option>العناية المركزة</option></select></label>
                  <label className="form-field"><span>الطبيب المسؤول</span><select name="attendingDoctor" defaultValue=""><option value="">يُحدد لاحقًا</option><option>د. ليلى قاسم</option><option>د. أحمد البياتي</option><option>د. سارة محمود</option><option>د. مريم حسن</option></select></label>
                  <label className="form-field"><span>تصنيف الدفع <b>*</b></span><select name="paymentCategory" required defaultValue="نقدي"><option>نقدي</option><option>مجاني</option><option>تأمين</option><option>آجل</option></select></label>
                  {(patientEntryType === "ولادة طبيعية" || patientEntryType === "عملية قيصرية") && <label className="form-field"><span>عدد المواليد</span><select name="newbornCount" value={newbornCount} onChange={(event) => setNewbornCount(Number(event.target.value))}><option value="0">يُسجل لاحقًا</option><option value="1">مولود واحد</option><option value="2">توأم</option><option value="3">ثلاثة توائم</option><option value="4">أربعة توائم</option></select></label>}
                  <label className="form-field full"><span>ملاحظات أولية</span><textarea name="notes" rows={3} placeholder="الحالة عند الدخول أو أي معلومات مهمة للكادر..." /></label>
                </div>
                {(patientEntryType === "ولادة طبيعية" || patientEntryType === "عملية قيصرية") && <div className="pricing-rule-note"><span>↻</span><p><b>قاعدة منع الازدواجية مفعّلة</b><small>إذا تحولت الحالة إلى رقود، يُبطل النظام تسعيرة الولادة ويحفظ سبب الإلغاء، ثم يبدأ التسعير التراكمي للرقود.</small></p></div>}
                {newbornNames.length > 0 && <div className="newborn-preview"><div><span>♙</span><p><b>السجلات التي سيُنشئها النظام</b><small>مرتبطة تلقائيًا بملف الأم ومنفصلة طبيًا وماليًا</small></p></div><ul>{newbornNames.map((name, index) => <li key={name}><i>{index + 1}</i>{name}<StatusPill tone="approved">مولود جديد</StatusPill></li>)}</ul></div>}
                <div className="registry-submit"><p><span>✓</span><small>سيظهر المريض مباشرة في البحث وحالات الدفع بعد التسجيل.</small></p><button className="primary-action" disabled={registrySaving}>{registrySaving ? "جارٍ الحفظ..." : "حفظ ملف المريض"}<span>←</span></button></div>
              </form>
            ) : (
              <form className="registry-form" onSubmit={(event) => submitRegistry(event, "employee")}>
                <div className="registry-form-head"><div><span>✦</span><p><b>بيانات الموظف</b><small>أنشئ الحساب وحدد الدور والاختصاص</small></p></div><StatusPill tone="approved">حساب جديد</StatusPill></div>
                <div className="form-section-title"><span>1</span><div><b>المعلومات الوظيفية</b><small>الهوية وبيانات الحساب</small></div></div>
                <div className="registry-fields">
                  <label className="form-field wide"><span>الاسم الكامل <b>*</b></span><input name="fullName" required placeholder="مثال: د. علي كريم حسن" /></label>
                  <label className="form-field"><span>الرقم الوظيفي <b>*</b></span><input name="employeeNumber" required defaultValue={`E-${2026 + registeredEmployees.length}`} dir="ltr" /></label>
                  <label className="form-field"><span>اسم المستخدم <b>*</b></span><input name="username" required placeholder="ali.kareem" dir="ltr" /></label>
                  <label className="form-field"><span>رقم الهاتف</span><input name="phone" type="tel" placeholder="07XX XXX XXXX" dir="ltr" /></label>
                  <label className="form-field"><span>تاريخ المباشرة <b>*</b></span><input name="joinDate" type="date" required defaultValue="2026-08-11" /></label>
                </div>
                <div className="form-section-title"><span>2</span><div><b>الدور والاختصاص</b><small>تُبنى الصلاحيات بناءً على الدور</small></div></div>
                <div className="registry-fields">
                  <label className="form-field"><span>الدور الوظيفي <b>*</b></span><select name="role" required value={employeeRole} onChange={(event) => setEmployeeRole(event.target.value)}><option>طبيب مقيم</option><option>رئيس الأطباء</option><option>موظف استقبال</option><option>موظف حسابات</option><option>الإدارة العليا</option></select></label>
                  <label className="form-field"><span>الاختصاص <b>*</b></span><select name="specialty" required defaultValue=""><option value="" disabled>اختر الاختصاص</option><option>النسائية والتوليد</option><option>الجراحة العامة</option><option>الطب الباطني</option><option>طب الأطفال</option><option>التخدير والعناية</option><option>الأشعة</option><option>المختبر</option><option>الاستقبال</option><option>الحسابات</option><option>الإدارة</option></select></label>
                  <label className="form-field"><span>حالة الحساب</span><select name="status" defaultValue="نشط"><option>نشط</option><option>موقوف مؤقتًا</option><option>إجازة</option></select></label>
                </div>
                {isDoctorRole && <div className="doctor-rules"><div className="smart-strip"><span className="ai-orb">✦</span><p><b>قواعد الطبيب المالية</b><small>تُستخدم تلقائيًا عند احتساب يوم العمل.</small></p></div><label className="form-field"><span>أقصى استشاريات يوميًا</span><input name="maxConsultations" type="number" min="0" defaultValue="10" /></label><label className="form-field"><span>السقف اليومي (د.ع)</span><input name="dailyCap" type="number" min="0" step="10000" defaultValue="200000" /></label></div>}
                <div className="registry-submit"><p><span>✓</span><small>سيحصل الموظف على صلاحيات {employeeRole} بعد تفعيل الحساب.</small></p><button className="primary-action" disabled={registrySaving}>{registrySaving ? "جارٍ الحفظ..." : "تسجيل الموظف"}<span>←</span></button></div>
              </form>
            )}
          </div>
        </section>

        <section className="panel registry-recent">
          <div className="panel-head"><div><h2>آخر السجلات</h2><p>{activeTab === "patient" ? "المرضى الذين أضيفوا مؤخرًا" : "الموظفون الذين أضيفوا مؤخرًا"}</p></div><span className="records-count">{latest.length} سجل</span></div>
          {registryLoading ? <div className="registry-empty"><span className="loading-ring" /><p>جارٍ تحميل السجلات...</p></div> : latest.length === 0 ? <div className="registry-empty"><span>＋</span><p><b>لا توجد سجلات بعد</b><small>استخدم النموذج أعلاه لإضافة أول سجل.</small></p></div> : <div className="recent-records">{activeTab === "patient" ? registeredPatients.map((item) => <div key={item.id}><span className="record-avatar">{item.fullName[0]}</span><p><b>{item.fullName}</b><small>{item.fileNumber} · {item.entryType || item.department} · {item.billingMode || "مقطوعي"}</small></p><StatusPill tone={item.patientStatus === "خرجت" ? "approved" : "pending"}>{item.patientStatus || "نشط"}</StatusPill><span className="lifecycle-actions">{(item.entryType === "ولادة طبيعية" || item.entryType === "عملية قيصرية") && <button onClick={() => updatePatientLifecycle(item.id, "convert_to_inpatient")}>تحويل إلى رقود</button>}{item.patientStatus !== "خرجت" && <button onClick={() => updatePatientLifecycle(item.id, "discharge")}>تسجيل خروج</button>}</span></div>) : registeredEmployees.map((item) => <div key={item.id}><span className="record-avatar employee">{item.fullName[0]}</span><p><b>{item.fullName}</b><small>{item.employeeNumber} · {item.role} · {item.specialty}</small></p><StatusPill tone="approved">{item.status}</StatusPill><time>حساب فعّال</time></div>)}</div>}
        </section>
      </>
    );
  }

  function renderHandover() {
    const doctorOptions = ["د. أحمد البياتي", "د. سارة محمود", "د. مريم حسن", "د. يوسف كريم"];
    const receivedPatients = handover?.patients ?? [];
    const handoverTime = handover?.shiftEndedAt
      ? new Date(handover.shiftEndedAt).toLocaleString("ar-IQ-u-nu-latn", { dateStyle: "medium", timeStyle: "short" })
      : "—";

    return <>
      <section className="page-title handover-title"><div><p className="eyebrow">استمرارية الرعاية</p><h1>تسليم واستلام المناوبة</h1><p>لا يبدأ الطبيب الجديد من الصفر؛ تظهر له الحالات المسلّمة وما يحتاج إلى متابعة فورًا.</p></div><StatusPill tone={handover?.status === "تم الاستلام" ? "approved" : "pending"}>{handover?.status || "لا يوجد تسليم حالي"}</StatusPill></section>

      <section className="handover-steps" aria-label="خطوات تسليم المناوبة">
        <article><span>1</span><div><b>إنهاء دوام الطبيب الأول</b><small>يحدد المرضى الموجودين تحت متابعته.</small></div></article>
        <i>←</i>
        <article><span>2</span><div><b>نقل المعلومات والمتابعات</b><small>يحفظ النظام الحالة والأولوية والإجراء التالي.</small></div></article>
        <i>←</i>
        <article><span>3</span><div><b>تأكيد الطبيب المستلم</b><small>تنتقل مسؤولية المتابعة إليه مع سجل زمني.</small></div></article>
      </section>

      <section className="handover-layout">
        <article className="panel received-handover">
          <div className="panel-head"><div><h2>المناوبة الواردة</h2><p>آخر تسليم محفوظ في النظام</p></div><span className="records-count">{receivedPatients.length} مرضى</span></div>
          {handoverLoading ? <div className="registry-empty"><span className="loading-ring" /><p>جارٍ تحميل المناوبة...</p></div> : !handover ? <div className="handover-empty"><span>⇄</span><div><b>لا يوجد تسليم بانتظارك</b><small>عند إنهاء الطبيب السابق لمناوبته ستظهر الحالات هنا مباشرة.</small></div></div> : <>
            <div className="handover-route">
              <div><small>الطبيب المسلّم</small><strong>{handover.fromDoctorName}</strong></div>
              <span>←</span>
              <div><small>الطبيب المستلم</small><strong>{handover.toDoctorName}</strong></div>
              <time>{handoverTime}</time>
            </div>
            {handover.notes && <div className="handover-note"><span>!</span><p><b>ملاحظة المناوبة</b>{handover.notes}</p></div>}
            <div className="handover-patient-list">
              {receivedPatients.map((item) => <div className="handover-patient" key={item.id}>
                <span className="record-avatar">{item.patient.fullName[0]}</span>
                <div><b>{item.patient.fullName}</b><small>{item.patient.fileNumber} · {item.clinicalSummary}</small><p>{item.pendingActions}</p></div>
                <span className={`priority ${item.priority === "مرتفع" ? "high" : "normal"}`}>{item.priority}</span>
                <StatusPill tone={item.receivedStatus === "مستلم" ? "approved" : "pending"}>{item.receivedStatus}</StatusPill>
              </div>)}
            </div>
            <button className="primary-action full" disabled={handoverSaving || handover.status === "تم الاستلام"} onClick={acceptHandover}>{handover.status === "تم الاستلام" ? "✓ تم استلام جميع المرضى" : handoverSaving ? "جارٍ تأكيد الاستلام..." : "تأكيد استلام المرضى وبدء المتابعة"}</button>
          </>}
        </article>

        <form className="panel outgoing-handover" onSubmit={createHandover}>
          <div className="panel-head"><div><h2>إنهاء المناوبة وتسليم المرضى</h2><p>أنشئ قائمة واضحة للطبيب الذي يأتي بعدك</p></div><span className="ai-tag">حفظ تلقائي</span></div>
          <div className="handover-doctors">
            <label className="form-field"><span>الطبيب المسلّم</span><select value={handoverFromDoctor} onChange={(event) => setHandoverFromDoctor(event.target.value)}>{doctorOptions.map((doctor) => <option key={doctor}>{doctor}</option>)}</select></label>
            <span>←</span>
            <label className="form-field"><span>الطبيب المستلم</span><select value={handoverToDoctor} onChange={(event) => setHandoverToDoctor(event.target.value)}>{doctorOptions.map((doctor) => <option key={doctor}>{doctor}</option>)}</select></label>
          </div>
          <div className="candidate-heading"><div><b>المرضى الموجودون حاليًا</b><small>حدد من تنتقل مسؤولية متابعته إلى الطبيب التالي</small></div><button type="button" onClick={() => setSelectedPatientIds(selectedPatientIds.length === handoverCandidates.length ? [] : handoverCandidates.map((patient) => patient.id))}>{selectedPatientIds.length === handoverCandidates.length && handoverCandidates.length > 0 ? "إلغاء الكل" : "تحديد الكل"}</button></div>
          <div className="handover-candidates">
            {handoverCandidates.length === 0 ? <div className="registry-empty"><span>✓</span><p><b>لا يوجد مرضى نشطون</b><small>ستظهر هنا الحالات المسجلة وغير الخارجة.</small></p></div> : handoverCandidates.map((patient) => <label className={selectedPatientIds.includes(patient.id) ? "selected" : ""} key={patient.id}>
              <input type="checkbox" checked={selectedPatientIds.includes(patient.id)} onChange={() => toggleHandoverPatient(patient.id)} />
              <span className="record-avatar">{patient.fullName[0]}</span>
              <p><b>{patient.fullName}</b><small>{patient.fileNumber} · {patient.entryType} · {patient.department}</small></p>
              <StatusPill tone={patient.entryType === "رقود" ? "returned" : "pending"}>{patient.entryType}</StatusPill>
            </label>)}
          </div>
          <label className="form-field handover-notes"><span>ملاحظة عامة للطبيب المستلم</span><textarea name="notes" rows={3} placeholder="مثال: مراجعة نتائج الفحوصات للحالات ذات الأولوية قبل الساعة 10:00" /></label>
          <div className="registry-submit"><p><span>✓</span><small>لن تتغير مسؤولية الطبيب إلا بعد تأكيد الاستلام.</small></p><button className="primary-action" disabled={handoverSaving || selectedPatientIds.length === 0}>{handoverSaving ? "جارٍ التسليم..." : `تسليم ${selectedPatientIds.length} مريضًا`}<span>←</span></button></div>
        </form>
      </section>
    </>;
  }

  function renderSettings() {
    const doctors = [
      ["د. أحمد البياتي", "10", "200,000"], ["د. سارة محمود", "12", "250,000"], ["د. مريم حسن", "10", "200,000"], ["د. يوسف كريم", "8", "180,000"],
    ];
    return <><section className="page-title"><div><p className="eyebrow">قواعد العمل</p><h1>{role === "admin" ? "إدارة النظام" : "سقوف الأطباء"}</h1><p>تُطبّق القيم فورًا على الحسابات الجديدة مع حفظ سجل التعديل.</p></div><StatusPill tone="approved">المحرك يعمل</StatusPill></section><section className="panel caps-panel"><div className="panel-head"><div><h2>السقوف الفردية</h2><p>الاستشاريات منفصلة عن سقف العمليات والرقود</p></div><button className="secondary-action" onClick={() => notify("حُفظت جميع إعدادات السقوف")}>حفظ التغييرات</button></div><div className="caps-table"><div className="caps-head"><span>الطبيب</span><span>أقصى استشاريات/يوم</span><span>السقف اليومي</span><span>آخر تحديث</span></div>{doctors.map((doctor, index) => <div className="caps-row" key={doctor[0]}><span className="doctor-cell"><i className="doctor-avatar">{doctor[0][3]}</i><b>{doctor[0]}</b></span><label><input defaultValue={doctor[1]} /><small>استشارية</small></label><label><input defaultValue={doctor[2]} /><small>د.ع</small></label><span className="muted">{index < 2 ? "اليوم" : "4 آب 2026"}</span></div>)}</div></section></>;
  }

  function renderReports() {
    return <><section className="page-title"><div><p className="eyebrow">الشفافية المالية</p><h1>{role === "doctor" ? "كشف الحساب" : "التقارير والتحليلات"}</h1><p>أرقام موحّدة قابلة للتتبع من الإجراء حتى الاعتماد والدفع.</p></div><button className="secondary-action" onClick={() => notify("تم تجهيز التقرير بصيغة قابلة للطباعة")}>⇩ تصدير التقرير</button></section><section className="report-layout"><article className="panel report-card"><div className="report-top"><div><span>إجمالي آب</span><strong>{money(role === "doctor" ? 2845000 : 18240000)}</strong><small>حتى 11 آب 2026</small></div><span className="growth">↑ 12.4%</span></div><div className="report-breakdown"><div><span>استشاريات</span><b>{money(1040000)}</b><i style={{ width: "62%" }} /></div><div><span>عمليات</span><b>{money(1210000)}</b><i style={{ width: "45%" }} /></div><div><span>رقود مدفوع</span><b>{money(595000)}</b><i style={{ width: "28%" }} /></div></div></article><article className="panel report-card"><div className="panel-head"><div><h2>جودة دورة العمل</h2><p>مؤشرات الشفافية والدقة</p></div></div><div className="quality-grid"><div><strong>98.7%</strong><span>دقة المطابقة</span></div><div><strong>34 د</strong><span>متوسط الاعتماد</span></div><div><strong>0</strong><span>دفعات مكررة</span></div><div><strong>96%</strong><span>اكتمال السجلات</span></div></div></article></section><section className="panel"><div className="panel-head"><div><h2>ملخص آخر 4 أسابيع</h2><p>المبالغ المعتمدة والمعلقة</p></div></div><div className="weekly-bars">{[["20–26 تموز", 62, "2.1 م"], ["27 تموز–2 آب", 74, "2.5 م"], ["3–9 آب", 91, "3.1 م"], ["10–16 آب", 38, "1.3 م"]].map((week) => <div key={week[0]}><span>{week[0]}</span><i><b style={{ width: `${week[1]}%` }} /></i><strong>{week[2]}</strong></div>)}</div></section></>;
  }

  function renderDays() {
    return <><section className="page-title"><div><p className="eyebrow">سجل الطبيب</p><h1>أيام العمل</h1><p>كل إدخالاتك، مرفقاتك وقرارات التدقيق في مكان واحد.</p></div><button className="primary-action" onClick={() => setAddOpen(true)}><b>＋</b> تسجيل يوم عمل</button></section><section className="panel all-days"><div className="toolbar"><div className="filters"><button className="active">الكل</button><button>معتمد</button><button>تدشيك الراتب</button><button>أُعيد</button></div><label className="table-search"><span>⌕</span><input placeholder="بحث في الأيام..." /></label></div><div className="day-list">{recentDays.concat([{ id: 5, day: "الثلاثاء", date: "5 آب 2026", status: "معتمد", amount: 210000, tone: "approved", details: "7 استشاريات · ولادة طبيعية" }]).map((item) => <button className="day-row" key={item.id} onClick={() => setDetailOpen(true)}><span className="date-tile"><b>{item.date.split(" ")[0]}</b><small>آب</small></span><span className="day-copy"><b>{item.day}</b><small>{item.details}</small></span><StatusPill tone={item.tone}>{item.status}</StatusPill><strong className="row-amount">{money(item.amount)}</strong><span className="chevron">‹</span></button>)}</div></section></>;
  }

  function renderContent() {
    if (view === "audit") return renderAudit();
    if (view === "payments") return renderPayments();
    if (view === "registry") return renderRegistry();
    if (view === "handover") return renderHandover();
    if (view === "personalSalary") return renderPersonalSalary();
    if (view === "settings") return renderSettings();
    if (view === "reports") return renderReports();
    if (view === "days") return renderDays();
    if (role === "chief") return renderChiefDashboard();
    if (role === "accounts") return renderAccountsDashboard();
    if (role === "admin") return renderAdminDashboard();
    return renderDoctorDashboard();
  }

  return (
    <div className={`app-shell ${sidebarExpanded ? "sidebar-open" : "sidebar-collapsed"}`}>
      <aside className="sidebar" aria-label="القائمة الجانبية">
        <div className="brand"><span>ب</span><div><b>البياتي</b><small>النظام الطبي الذكي</small></div></div>
        <button className="sidebar-toggle" type="button" aria-expanded={sidebarExpanded} aria-label={sidebarExpanded ? "طي القائمة الجانبية" : "إظهار القائمة الجانبية"} onClick={() => setSidebarExpanded((expanded) => !expanded)}><Icon>{sidebarExpanded ? "→" : "☰"}</Icon><span>{sidebarExpanded ? "طي القائمة" : "إظهار القائمة"}</span></button>
        <nav aria-label="القائمة الرئيسية">
          <p>القائمة الرئيسية</p>
          {navItems.map((item) => <button key={item.id} title={!sidebarExpanded ? item.label : undefined} className={view === item.id ? "active" : ""} onClick={() => navigateTo(item.id)}><Icon>{item.icon}</Icon><span>{item.label}</span>{item.id === "audit" && auditRows.length > 0 && <i className="nav-count">{auditRows.length}</i>}</button>)}
        </nav>
        <div className="sidebar-bottom"><button title={!sidebarExpanded ? "مركز المساعدة" : undefined} onClick={() => navigateTo("settings")}><Icon>؟</Icon><span>مركز المساعدة</span></button><div className="secure-chip"><span>✓</span><p><b>بياناتك محمية</b><small>آخر مزامنة: الآن</small></p></div></div>
      </aside>
      {sidebarExpanded && <button type="button" className="sidebar-scrim" aria-label="إغلاق القائمة" onClick={() => setSidebarExpanded(false)} />}

      <div className="main-column">
        <header className="topbar">
          <div className="mobile-brand"><button type="button" className="menu-trigger" aria-label="إظهار القائمة الجانبية" onClick={() => setSidebarExpanded(true)}>☰</button><span>ب</span><b>البياتي</b></div>
          <label className="global-search"><span>⌕</span><input aria-label="البحث في النظام" placeholder="ابحث عن مريض، طبيب أو يوم عمل..." /></label>
          <div className="top-actions"><button className="icon-button" aria-label="الإشعارات"><span>♢</span><i /></button><span className="divider" /><div className="role-picker"><span className="user-avatar">{currentRole.name.split(" ")[1]?.[0] || "ب"}</span><div><b>{currentRole.name}</b><small>{currentRole.label}</small></div><select aria-label="تبديل الدور للمعاينة" value={role} onChange={(event) => changeRole(event.target.value as Role)}>{roles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div></div>
        </header>
        <main>{renderContent()}</main>
        <nav className="mobile-nav" aria-label="قائمة الهاتف">{navItems.slice(0, 4).map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigateTo(item.id)}><Icon>{item.icon}</Icon><small>{item.label.split(" ")[0]}</small></button>)}</nav>
      </div>

      {addOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAddOpen(false)}><form className="entry-modal" onSubmit={submitDay}>
        <div className="modal-head"><div><p className="eyebrow">إدخال سريع · 11 آب 2026</p><h2>تسجيل يوم عمل جديد</h2><p>سيطبّق محرك البياتي القواعد قبل الحفظ.</p></div><button type="button" className="close-button" onClick={() => setAddOpen(false)}>×</button></div>
        <div className="smart-strip"><span className="ai-orb">✦</span><p><b>الحساب الذكي نشط</b><small>الحد: 10 استشاريات · سقف العمليات والرقود: {money(200000)}</small></p></div>
        <div className="entry-section"><div className="section-label"><span>1</span><div><b>الاستشاريات</b><small>تُحسب خارج السقف اليومي</small></div></div><label className="number-field"><span>عدد الاستشاريات</span><div><button type="button" onClick={() => setConsultations(Math.max(0, consultations - 1))}>−</button><input type="number" min="0" value={consultations} onChange={(event) => setConsultations(Number(event.target.value))} /><button type="button" onClick={() => setConsultations(consultations + 1)}>＋</button></div></label>{consultations > 10 && <p className="inline-warning">سيُحتسب 10 فقط حسب سقفك الحالي.</p>}<button className="upload-box" type="button" onClick={() => notify("يمكنك اختيار الصور من الكاميرا أو الجهاز", "info")}><span>▧</span><b>إرفاق صور الإثباتات</b><small>الكاميرا أو معرض الصور</small></button></div>
        <div className="entry-section"><div className="section-label"><span>2</span><div><b>العمليات والرقود</b><small>تدخل ضمن السقف اليومي</small></div></div><div className="procedure-inputs"><label><span>ولادة طبيعية</span><input type="number" min="0" value={births} onChange={(event) => setBirths(Number(event.target.value))} /></label><label><span>عملية قيصرية</span><input type="number" min="0" value={cesareans} onChange={(event) => setCesareans(Number(event.target.value))} /></label><label><span>حالات رقود مدفوعة</span><input type="number" min="0" value={inpatients} onChange={(event) => setInpatients(Number(event.target.value))} /></label></div></div>
        <div className="calculation-box"><div><span>المبلغ الأولي</span><b>{money(dailyCalculation.enteredTotal)}</b></div>{capDiscount > 0 && <div className="discount-line"><span>خصم تجاوز السقف</span><b>− {money(capDiscount)}</b></div>}<div className="final-line"><span>المبلغ المتوقع بعد القواعد</span><strong>{money(estimatedTotal)}</strong></div></div>
        <div className="modal-actions"><button type="button" className="secondary-action" onClick={() => setAddOpen(false)}>إلغاء</button><button className="primary-action" type="submit">حفظ وإغلاق <span>←</span></button></div>
      </form></div>}

      {detailOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDetailOpen(false)}><aside className="detail-drawer"><div className="modal-head"><div><p className="eyebrow">الأربعاء، 6 آب 2026</p><h2>تفاصيل يوم العمل</h2></div><button className="close-button" onClick={() => setDetailOpen(false)}>×</button></div><StatusPill tone="returned">أُعيد للمراجعة</StatusPill><div className="review-note"><span>!</span><p><b>ملاحظة رئيس الأطباء</b>يرجى إرفاق صورة إثبات الاستشارية الخامسة ثم حفظ التعديل.</p></div><div className="detail-lines"><div><span>5 استشاريات</span><b>{money(50000)}</b></div><div><span>ولادة طبيعية · زينب علي</span><b>{money(80000)}</b></div><div><span>رقود مدفوع · حالتان</span><b>{money(50000)}</b></div><div className="subtotal"><span>المبلغ الأولي</span><b>{money(180000)}</b></div><div className="discount-line"><span>خصم التدقيق</span><b>− {money(55000)}</b></div><div className="total"><span>المبلغ الحالي</span><strong>{money(125000)}</strong></div></div><button className="upload-box drawer-upload" onClick={() => notify("تمت إضافة صورة الإثبات بنجاح")}><span>▧</span><b>إضافة الإثبات الناقص</b><small>ثم حفظ اليوم ليظهر للتدقيق</small></button><button className="primary-action full" onClick={() => { setDetailOpen(false); notify("حُفظ اليوم بعد استكمال الإثبات وظهر للتدقيق"); }}>حفظ التعديل</button></aside></div>}
      {toast && <div className={`toast ${toast.kind}`}><span>{toast.kind === "success" ? "✓" : "i"}</span>{toast.message}</div>}
    </div>
  );
}
