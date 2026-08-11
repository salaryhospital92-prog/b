"use client";

import { useState } from "react";
import { DAY_PAYMENT_STATES, type DayPaymentState } from "../lib/rules-engine";
import { useRemoteData } from "../lib/use-remote-data";

type DayCell = { date: string; billable: boolean; status: DayPaymentState | null };
type PatientStay = {
  id: number; fullName: string; fileNumber: string; department: string;
  admissionDate: string; dischargeDate: string | null; patientStatus: string;
  attendingDoctor: string | null; isNewborn: boolean; isPremature: boolean;
  incubatorNote: string | null; motherName: string | null; days: DayCell[]; stayDays: number;
};
type DoctorTotal = { doctor_name: string; paid_days: number; pending_days: number; free_days: number; paid_total: number; pending_total: number };
type LedgerData = {
  range: { from: string; to: string; days: string[] };
  dayFee: number;
  canEdit: boolean;
  patients: PatientStay[];
  premature: PatientStay[];
  doctorTotals: DoctorTotal[];
  myTotals: { paidDays: number; pendingDays: number; freeDays: number; paidTotal: number; pendingTotal: number };
};

const IQD = new Intl.NumberFormat("ar-IQ");
const STATE_STYLE: Record<DayPaymentState, string> = {
  "مدفوع": "paid",
  "لم تدفع بعد": "pending",
  "مجاني": "free",
};
const STATE_MARK: Record<DayPaymentState, string> = { "مدفوع": "✓", "لم تدفع بعد": "⌛", "مجاني": "○" };

/** Clicking a day walks it through the three states, so billing is one tap. */
function nextState(current: DayPaymentState | null): DayPaymentState {
  const index = current ? DAY_PAYMENT_STATES.indexOf(current) : -1;
  return DAY_PAYMENT_STATES[(index + 1) % DAY_PAYMENT_STATES.length];
}

function shortDay(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export default function InpatientDays({ accountName, role, notify }: {
  accountName: string;
  role: string;
  notify: (message: string, kind?: "success" | "info") => void;
}) {
  const [busyCell, setBusyCell] = useState("");
  const [onlyPremature, setOnlyPremature] = useState(false);

  const { data, error, loading, reload } = useRemoteData<LedgerData>(
    `/api/inpatient-days?actorName=${encodeURIComponent(accountName)}`,
    "تعذر تحميل أيام الرقود",
  );

  async function cycleDay(patient: PatientStay, cell: DayCell) {
    if (!data?.canEdit || !cell.billable) return;
    const key = `${patient.id}:${cell.date}`;
    setBusyCell(key);
    try {
      const response = await fetch("/api/inpatient-days", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorName: accountName,
          patientId: patient.id,
          recordDate: cell.date,
          status: nextState(cell.status),
          doctorName: patient.attendingDoctor,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "تعذر التحديث");
      reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر التحديث", "info");
    } finally {
      setBusyCell("");
    }
  }

  async function togglePremature(patient: PatientStay) {
    if (!data?.canEdit) return;
    try {
      const response = await fetch("/api/inpatient-days", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorName: accountName, patientId: patient.id, isPremature: !patient.isPremature }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "تعذر التحديث");
      notify(payload.message);
      reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر التحديث", "info");
    }
  }

  if (!data) return (
    <section className="panel">
      <header className="panel-head"><div><h2>أيام الرقود والدفع</h2><p>{loading ? "جارٍ التحميل..." : error || "تعذر تحميل أيام الرقود"}</p></div></header>
      {!loading && <div className="load-failed"><p>{error}</p><button type="button" className="primary-action" onClick={reload}>إعادة المحاولة<span>↻</span></button></div>}
    </section>
  );

  const rows = onlyPremature ? data.premature : data.patients;
  const isDoctor = role === "doctor" || role === "chief";

  return (
    <section className="panel ledger-panel">
      <header className="panel-head">
        <div>
          <h2>أيام الرقود وحالات الدفع</h2>
          <p>كل يوم رقود له حالة واحدة: مدفوع يُحتسب، لم تدفع بعد يبقى معلّقًا، مجاني لا يُحتسب. تغيير أي يوم يعيد حساب الأجور فورًا بأثر رجعي.</p>
        </div>
      </header>

      <div className="ledger-totals">
        <article className="ledger-total paid">
          <span>✓</span>
          <div><small>الحساب الكلي المدفوع (فعلي)</small><b>{IQD.format(data.myTotals.paidTotal)} د.ع</b><em>{data.myTotals.paidDays} يوم مؤكد</em></div>
        </article>
        <article className="ledger-total pending">
          <span>⌛</span>
          <div><small>الحساب الكلي المتوقع (معلّق)</small><b>{IQD.format(data.myTotals.pendingTotal)} د.ع</b><em>{data.myTotals.pendingDays} يوم بانتظار الدفع</em></div>
        </article>
        <article className="ledger-total free">
          <span>○</span>
          <div><small>أيام مجانية</small><b>{data.myTotals.freeDays} يوم</b><em>لا تُحتسب في الأجر</em></div>
        </article>
      </div>

      {isDoctor && (
        <p className="ledger-hint">المبلغ المعلّق ليس دَينًا مؤكدًا — يتحول إلى «مدفوع» تلقائيًا فور تأكيد الحسابات لليوم، وينزل من المعلّق في اللحظة نفسها.</p>
      )}

      {data.premature.length > 0 && (
        <div className="incubator-panel">
          <div className="incubator-head"><span>👶</span><div><b>حاضنات الأطفال الخدج</b><small>إقامات طويلة بتواريخ دخول مستقلة عن الأم</small></div><i>{data.premature.length}</i></div>
          <ul>
            {data.premature.map((baby) => (
              <li key={baby.id}>
                <b>{baby.fullName}</b>
                <span>دخل {baby.admissionDate}</span>
                <i>{baby.stayDays} يوم</i>
                {baby.motherName && <em>الأم: {baby.motherName}</em>}
                {baby.incubatorNote && <small>{baby.incubatorNote}</small>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="ledger-controls">
        <button type="button" className={onlyPremature ? "active" : ""} onClick={() => setOnlyPremature((value) => !value)}>
          {onlyPremature ? "عرض كل الراقدات" : "الخدج فقط"}
        </button>
        <span>الفترة {shortDay(data.range.from)} — {shortDay(data.range.to)} · يوم الرقود {IQD.format(data.dayFee)} د.ع</span>
        {data.canEdit && <em>اضغط أي يوم لتبديله: مدفوع ← لم تدفع بعد ← مجاني</em>}
      </div>

      {rows.length === 0 ? (
        <p className="empty-hint">لا توجد حالات رقود في هذه الفترة.</p>
      ) : (
        <div className="ledger-scroll">
          <table className="ledger-table">
            <thead>
              <tr>
                <th className="ledger-name">المريضة</th>
                <th>الطبيب</th>
                {data.range.days.map((day) => <th key={day} className="ledger-day">{shortDay(day)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((patient) => (
                <tr key={patient.id}>
                  <td className="ledger-name">
                    <b>{patient.fullName}</b>
                    <small>{patient.fileNumber} · {patient.department}</small>
                    <span className="ledger-tags">
                      {patient.isPremature && <i className="tag-premature">خديج</i>}
                      {patient.isNewborn && <i className="tag-newborn">مولود</i>}
                      {data.canEdit && <button type="button" onClick={() => togglePremature(patient)}>{patient.isPremature ? "إزالة الخديج" : "تحديد كخديج"}</button>}
                    </span>
                  </td>
                  <td className="ledger-doctor">{patient.attendingDoctor || "—"}</td>
                  {patient.days.map((cell) => {
                    const key = `${patient.id}:${cell.date}`;
                    const className = !cell.billable ? "ledger-cell out" : cell.status ? `ledger-cell ${STATE_STYLE[cell.status]}` : "ledger-cell unset";
                    return (
                      <td key={cell.date} className={className}>
                        <button
                          type="button"
                          disabled={!data.canEdit || !cell.billable || busyCell === key}
                          onClick={() => cycleDay(patient, cell)}
                          title={cell.billable ? `${cell.date} — ${cell.status || "لم تُسجل"}` : "خارج فترة الرقود"}
                          aria-label={`${patient.fullName} ${cell.date} ${cell.status || "لم تُسجل"}`}
                        >
                          {cell.billable ? (cell.status ? STATE_MARK[cell.status] : "·") : ""}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.doctorTotals.length > 0 && (
        <div className="ledger-doctors">
          <b>أرصدة الرقود لكل طبيب</b>
          <ul>
            {data.doctorTotals.map((doctor) => (
              <li key={doctor.doctor_name}>
                <span>{doctor.doctor_name}</span>
                <i className="paid">مدفوع {IQD.format(Number(doctor.paid_total))} د.ع</i>
                <i className="pending">معلّق {IQD.format(Number(doctor.pending_total))} د.ع</i>
                <em>{doctor.paid_days} مدفوع · {doctor.pending_days} معلّق · {doctor.free_days} مجاني</em>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
