"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRemoteData } from "../lib/use-remote-data";
import { planMonth } from "../lib/shift-planner";
import { rosterImageBlob } from "../lib/roster-image";

type ShiftName = "صباحية" | "مسائية";
type Assignment = { day: number; shift: ShiftName; employeeId: number; fullName: string };
type Doctor = { id: number; fullName: string; phone: string | null };
type AvailabilityRow = {
  employee_id: number; fullName: string; available_days: number[];
  preferred_shift: string; max_shifts: number | null; note: string | null; submitted_at: string;
};
type MonthInfo = {
  id: number; key: string; label: string; days: number; year: number; monthNumber: number;
  status: string; doctors_per_shift: number; morning_start: string; evening_start: string; shift_hours: number;
};
type ShareLink = { fullName: string; phone: string | null; shifts: number; whatsappLink: string | null; personalText: string };
type ShiftsData = {
  month: MonthInfo;
  canManage: boolean;
  me: { id: number; fullName: string; role: string; isResident: boolean; availability: AvailabilityRow | null; shifts: Assignment[] };
  doctors: Doctor[];
  availability: AvailabilityRow[];
  assignments: Assignment[];
  published: boolean;
};

const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const SHIFTS: ShiftName[] = ["صباحية", "مسائية"];

function weekday(year: number, month: number, day: number) {
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function monthOptions() {
  const now = new Date();
  return Array.from({ length: 4 }, (_, offset) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    return { key, label: new Intl.DateTimeFormat("ar-IQ", { month: "long", year: "numeric", timeZone: "UTC" }).format(date) };
  });
}


function RosterBoard({ month, doctors, assignments, domId, onChangeCell, busy, readOnly }: {
  month: MonthInfo;
  doctors: Doctor[];
  assignments: Assignment[];
  domId?: string;
  onChangeCell?: (day: number, shift: ShiftName, employeeId: number) => void;
  busy?: boolean;
  readOnly?: boolean;
}) {
  const allDays = Array.from({ length: month.days }, (_, index) => index + 1);
  const cellFor = (day: number, shift: ShiftName) => assignments.find((item) => item.day === day && item.shift === shift);
  return (
    <div className="roster-board" id={domId}>
      <div className="roster-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" width={38} height={38} />
        <div><b>مقيمو مستشفى البياتي</b><small>جدول المناوبات — {month.label}</small></div>
        <span className="roster-brand-mark">نظام البياتي الطبي الذكي</span>
      </div>
      <div className="roster-scroll">
        <table className="roster-table">
          <thead>
            <tr>
              <th className="roster-date">التاريخ</th>
              <th className="roster-weekday">اليوم</th>
              {doctors.map((doctor) => <th key={doctor.id} className="roster-doctor">{doctor.fullName}</th>)}
              <th className="roster-morning">مورنك</th>
              <th className="roster-night">نايت</th>
            </tr>
          </thead>
          <tbody>
            {allDays.map((day) => {
              const onDuty = assignments.filter((item) => item.day === day);
              const isWeekend = [5, 6].includes(new Date(Date.UTC(month.year, month.monthNumber - 1, day)).getUTCDay());
              return (
                <tr key={day} className={isWeekend ? "roster-weekend" : ""}>
                  <td className="roster-date">{day}</td>
                  <td className="roster-weekday">{weekday(month.year, month.monthNumber, day)}</td>
                  {doctors.map((doctor) => {
                    const shift = onDuty.find((item) => item.employeeId === doctor.id);
                    return <td key={doctor.id} className={shift ? `roster-on roster-on-${shift.shift === "صباحية" ? "morning" : "night"}` : ""}>{shift ? doctor.fullName : ""}</td>;
                  })}
                  {SHIFTS.map((shift) => {
                    const current = cellFor(day, shift);
                    return (
                      <td key={shift} className={`roster-slot ${current ? "" : "roster-empty"}`}>
                        {readOnly || !onChangeCell
                          ? <span>{current?.fullName || "—"}</span>
                          : (
                            <select value={current?.employeeId || 0} onChange={(event) => onChangeCell(day, shift, Number(event.target.value))} disabled={busy} aria-label={`${shift} ليوم ${day}`}>
                              <option value={0}>—</option>
                              {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.fullName}</option>)}
                            </select>
                          )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="roster-foot">
        <span>مورنك {month.morning_start} · نايت {month.evening_start} · {month.shift_hours} ساعة</span>
        {!readOnly && <button type="button" className="ghost-action" onClick={() => window.print()}>طباعة / حفظ PDF</button>}
      </div>
    </div>
  );
}

export default function ShiftSchedule({ accountName, notify }: { accountName: string; notify: (message: string, kind?: "success" | "info") => void }) {
  const months = useMemo(() => monthOptions(), []);
  const [monthKey, setMonthKey] = useState(months[1]?.key || months[0].key);
  const [saving, setSaving] = useState(false);
  // null means "untouched this visit", so the saved answer shows through without
  // an effect copying server state into form state.
  const [dayDraft, setDayDraft] = useState<number[] | null>(null);
  const [shiftDraft, setShiftDraft] = useState<string | null>(null);
  const [maxDraft, setMaxDraft] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  const [whatsappText, setWhatsappText] = useState("");
  const [demo, setDemo] = useState<Assignment[] | null>(null);
  const [sharing, setSharing] = useState(false);

  const { data, error, loading, reload: load } = useRemoteData<ShiftsData>(
    `/api/shifts?month=${monthKey}&actorName=${encodeURIComponent(accountName)}`,
    "تعذر تحميل الجدول",
  );

  const saved = data?.me.availability ?? null;
  const selectedDays = dayDraft ?? saved?.available_days ?? [];
  const preferredShift = shiftDraft ?? saved?.preferred_shift ?? "كلاهما";
  const maxShifts = maxDraft ?? (saved?.max_shifts ? String(saved.max_shifts) : "");

  function resetDrafts() {
    setDayDraft(null);
    setShiftDraft(null);
    setMaxDraft(null);
  }

  async function submitAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = new FormData(event.currentTarget).get("note");
    setSaving(true);
    try {
      const response = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorName: accountName, month: monthKey, availableDays: selectedDays, preferredShift, maxShifts: Number(maxShifts) || null, note }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "تعذر الإرسال");
      notify(payload.message);
      resetDrafts();
      load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر الإرسال", "info");
    } finally {
      setSaving(false);
    }
  }

  async function generate() {
    setSaving(true);
    try {
      const response = await fetch("/api/shifts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorName: accountName, month: monthKey, doctorsPerShift: data?.month.doctors_per_shift || 1 }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "تعذر التوليد");
      setWarnings(payload.warnings || []);
      notify(payload.message);
      load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر التوليد", "info");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdits(next: Assignment[]) {
    setSaving(true);
    try {
      const response = await fetch("/api/shifts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorName: accountName, month: monthKey, assignments: next.map((item) => ({ day: item.day, shift: item.shift, employeeId: item.employeeId })) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "تعذر الحفظ");
      load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر الحفظ", "info");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setSaving(true);
    try {
      const response = await fetch("/api/shifts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorName: accountName, month: monthKey }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "تعذر النشر");
      setShareLinks(payload.shareLinks || []);
      setWhatsappText(payload.whatsappText || "");
      notify(payload.message);
      load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر النشر", "info");
    } finally {
      setSaving(false);
    }
  }

  /**
   * A throwaway roster so the chief can see the layout before anyone submits.
   * Runs entirely in the browser and writes nothing — no API call, no database.
   */
  function buildDemo() {
    if (!data) return;
    const allDays = Array.from({ length: data.month.days }, (_, index) => index + 1);
    const plan = planMonth({
      year: data.month.year,
      month: data.month.monthNumber,
      doctors: data.doctors.map((doctor, index) => ({
        employeeId: doctor.id,
        fullName: doctor.fullName,
        // Staggered days off, but loose enough that the demo month comes out fully covered.
        availableDays: allDays.filter((day) => (day + index) % 5 !== 0),
        preferredShift: index === 1 ? "مسائية" : "كلاهما",
      })),
      doctorsPerShift: 1,
    });
    setDemo(plan.assignments);
    notify("هذه معاينة تجريبية فقط — لم يُحفظ أي شيء في قاعدة البيانات");
  }

  async function shareAsImage(rows: Assignment[], watermark?: string) {
    if (!data) return;
    setSharing(true);
    try {
      const blob = await rosterImageBlob({
        monthLabel: data.month.label,
        year: data.month.year,
        month: data.month.monthNumber,
        days: data.month.days,
        doctors: data.doctors.map((doctor) => ({ id: doctor.id, fullName: doctor.fullName })),
        assignments: rows,
        morningStart: data.month.morning_start,
        eveningStart: data.month.evening_start,
        shiftHours: data.month.shift_hours,
        watermark,
      });
      const file = new File([blob], `albayati-roster-${data.month.key}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `جدول المناوبات — ${data.month.label}` });
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      URL.revokeObjectURL(url);
      notify("نُزّلت الصورة — أرفقها في واتساب أو أي محادثة");
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر إنشاء الصورة", "info");
    } finally {
      setSharing(false);
    }
  }

  function toggleDay(day: number) {
    setDayDraft(selectedDays.includes(day)
      ? selectedDays.filter((value) => value !== day)
      : [...selectedDays, day].sort((a, b) => a - b));
  }

  function changeCell(day: number, shift: ShiftName, employeeId: number) {
    if (!data) return;
    const rest = data.assignments.filter((item) => !(item.day === day && item.shift === shift));
    const next = employeeId ? [...rest, { day, shift, employeeId, fullName: data.doctors.find((doctor) => doctor.id === employeeId)?.fullName || "" }] : rest;
    saveEdits(next.sort((left, right) => left.day - right.day));
  }

  if (!data) return (
    <section className="panel">
      <header className="panel-head"><div><h2>جدول المناوبات</h2><p>{loading ? "جارٍ التحميل..." : error || "تعذر تحميل الجدول"}</p></div></header>
      {!loading && <div className="load-failed"><p>{error}</p><button type="button" className="primary-action" onClick={load}>إعادة المحاولة<span>↻</span></button></div>}
    </section>
  );

  const { month, canManage, me, doctors, availability, assignments } = data;
  const allDays = Array.from({ length: month.days }, (_, index) => index + 1);

  return (
    <section className="panel shift-panel">
      <header className="panel-head">
        <div>
          <h2>جدول مناوبات الأطباء المقيمين</h2>
          <p>كل مقيم يحدد أيام تفرغه، والنظام يوزّع المناوبات صباحية ومسائية بعدالة ثم يرسلها.</p>
        </div>
        <label className="shift-month-picker"><span>الشهر</span>
          <select value={monthKey} onChange={(event) => { setMonthKey(event.target.value); resetDrafts(); setWarnings([]); setShareLinks([]); setWhatsappText(""); setDemo(null); }}>
            {months.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
      </header>

      <div className={`shift-status shift-status-${month.status === "منشور" ? "published" : month.status === "قيد الجدولة" ? "drafting" : "open"}`}>
        <span>{month.status === "منشور" ? "✓" : month.status === "قيد الجدولة" ? "◐" : "○"}</span>
        <p><b>{month.status === "منشور" ? "الجدول منشور" : month.status === "قيد الجدولة" ? "الجدول قيد الإعداد" : "باب أيام التفرغ مفتوح"}</b>
          <small>{month.status === "منشور" ? "استلم الأطباء مناوباتهم عبر البوت" : `${availability.length} من ${doctors.length} طبيبًا أرسلوا أيامهم`}</small></p>
      </div>

      {me.isResident && (
        <form className="shift-availability" onSubmit={submitAvailability}>
          <div className="registry-form-head"><div><span>◷</span><p><b>أيام تفرّغي — {month.label}</b><small>اضغط على الأيام التي تستطيع فيها استلام مناوبة</small></p></div>
            {me.availability && <span className="shift-chip">أُرسلت · {me.availability.available_days.length} يوم</span>}</div>

          <div className="shift-day-grid" role="group" aria-label="أيام التفرغ">
            {allDays.map((day) => (
              <button type="button" key={day} className={selectedDays.includes(day) ? "shift-day on" : "shift-day"}
                aria-pressed={selectedDays.includes(day)} disabled={month.status === "منشور"} onClick={() => toggleDay(day)}>
                <b>{day}</b><small>{weekday(month.year, month.monthNumber, day).slice(0, 3)}</small>
              </button>
            ))}
          </div>

          <div className="shift-quick-picks">
            <button type="button" onClick={() => setDayDraft(allDays)}>كل الأيام</button>
            <button type="button" onClick={() => setDayDraft(allDays.filter((day) => ![5, 6].includes(new Date(Date.UTC(month.year, month.monthNumber - 1, day)).getUTCDay())))}>أيام العمل فقط</button>
            <button type="button" onClick={() => setDayDraft([])}>مسح الاختيار</button>
            <span>{selectedDays.length} يوم محدد</span>
          </div>

          <div className="registry-fields">
            <label className="form-field"><span>المناوبة المفضلة</span>
              <select value={preferredShift} onChange={(event) => setShiftDraft(event.target.value)} disabled={month.status === "منشور"}>
                <option>كلاهما</option><option>صباحية</option><option>مسائية</option>
              </select></label>
            <label className="form-field"><span>أقصى عدد مناوبات (اختياري)</span>
              <input type="number" min="1" max="31" value={maxShifts} placeholder="بدون حد" disabled={month.status === "منشور"} onChange={(event) => setMaxDraft(event.target.value)} /></label>
            <label className="form-field full"><span>ملاحظة لرئيس المقيمين</span>
              <textarea name="note" rows={2} defaultValue={me.availability?.note || ""} placeholder="ظرف خاص، امتحان، سفر..." disabled={month.status === "منشور"} /></label>
          </div>

          <div className="registry-submit">
            <p><span>✓</span><small>يمكنك تعديل أيامك وإعادة الإرسال ما دام الجدول غير منشور.</small></p>
            <button className="primary-action" disabled={saving || !selectedDays.length || month.status === "منشور"}>{saving ? "جارٍ الإرسال..." : me.availability ? "تحديث أيامي" : "إرسال إلى رئيس المقيمين"}<span>←</span></button>
          </div>
        </form>
      )}

      {me.shifts.length > 0 && (
        <div className="shift-mine">
          <b>مناوباتي في {month.label} ({me.shifts.length})</b>
          <ul>{me.shifts.map((item) => <li key={`${item.day}-${item.shift}`}><i>{item.day}</i>{weekday(month.year, month.monthNumber, item.day)} — {item.shift} ({item.shift === "صباحية" ? month.morning_start : month.evening_start})</li>)}</ul>
        </div>
      )}

      {canManage && (
        <>
          <div className="shift-submissions">
            <b>أيام التفرغ المستلمة</b>
            {availability.length === 0 ? <p className="empty-hint">لم يرسل أي طبيب أيامه بعد.</p> : (
              <ul>{availability.map((row) => <li key={row.employee_id}><span>{row.fullName}</span><i>{row.available_days.length} يوم</i><em>{row.preferred_shift}</em>{row.note && <small>{row.note}</small>}</li>)}</ul>
            )}
            {doctors.filter((doctor) => !availability.some((row) => Number(row.employee_id) === doctor.id)).map((doctor) => (
              <p key={doctor.id} className="shift-missing">لم يرسل بعد: {doctor.fullName}</p>
            ))}
          </div>

          <div className="shift-actions">
            <button className="primary-action" onClick={generate} disabled={saving || !availability.length}>{saving ? "جارٍ التوزيع..." : "توليد الجدول تلقائيًا"}<span>⚡</span></button>
            <button className="ghost-action" onClick={publish} disabled={saving || !assignments.length}>نشر وإشعار الأطباء<span>↗</span></button>
            <button className="ghost-action" onClick={buildDemo} disabled={!doctors.length}>معاينة جدول تجريبي<span>👁</span></button>
            <button className="ghost-action" onClick={() => shareAsImage(assignments)} disabled={sharing || !assignments.length}>{sharing ? "جارٍ التجهيز..." : "مشاركة كصورة"}<span>🖼</span></button>
          </div>

          {warnings.map((warning) => <p key={warning} className="shift-warning">⚠ {warning}</p>)}

          {demo && (
            <div className="roster-demo">
              <div className="roster-demo-head">
                <b>معاينة تجريبية — {month.label}</b>
                <span>بيانات وهمية للعرض فقط · لم تُحفظ في قاعدة البيانات</span>
                <button className="ghost-action" onClick={() => shareAsImage(demo, "معاينة تجريبية")} disabled={sharing}>{sharing ? "جارٍ التجهيز..." : "مشاركة الصورة"}</button>
                <button className="ghost-action" onClick={() => setDemo(null)}>إغلاق المعاينة</button>
              </div>
              <RosterBoard month={month} doctors={doctors} assignments={demo} readOnly />
            </div>
          )}

          {assignments.length > 0 && (
            <RosterBoard
              month={month}
              doctors={doctors}
              assignments={assignments}
              domId="albayati-roster"
              onChangeCell={changeCell}
              busy={saving}
            />
          )}

          {whatsappText && (
            <div className="shift-share">
              <b>مشاركة الجدول عبر واتساب</b>
              <p className="empty-hint">الجدول منسّق بخط ثابت العرض ليبقى مرتّبًا داخل محادثة واتساب.</p>
              <div className="shift-share-actions">
                <a className="primary-action" href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`} target="_blank" rel="noreferrer">إرسال الجدول الكامل<span>↗</span></a>
                <button className="ghost-action" onClick={() => { navigator.clipboard.writeText(whatsappText); notify("نُسخ الجدول — الصقه في أي محادثة"); }}>نسخ النص</button>
              </div>
              <ul className="shift-share-list">
                {shareLinks.map((link) => (
                  <li key={link.fullName}>
                    <span>{link.fullName}</span><i>{link.shifts} مناوبة</i>
                    {link.whatsappLink
                      ? <a href={link.whatsappLink} target="_blank" rel="noreferrer">إرسال له</a>
                      : <em>لا يوجد رقم هاتف مسجل</em>}
                  </li>
                ))}
              </ul>
              <pre className="shift-preview">{whatsappText}</pre>
            </div>
          )}
        </>
      )}
    </section>
  );
}
