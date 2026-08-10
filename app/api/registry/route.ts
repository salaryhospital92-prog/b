import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { employees, patientEvents, patients } from "../../../db/schema";
import { buildNewbornNames, getBillingMode, getInitialPrice } from "../../../lib/rules-engine";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "تعذر حفظ السجل";
  if (message.includes("UNIQUE constraint failed")) return "رقم الملف أو اسم المستخدم مسجل مسبقًا";
  if (message.includes("no such table") || message.includes("no column named")) return "قاعدة التسجيل قيد التجهيز، حاول مرة أخرى بعد قليل";
  return message;
}

export async function GET() {
  try {
    const db = getDb();
    const [patientRows, employeeRows] = await Promise.all([
      db.select().from(patients).where(eq(patients.isNewborn, false)).orderBy(desc(patients.createdAt), desc(patients.id)).limit(12),
      db.select().from(employees).orderBy(desc(employees.createdAt), desc(employees.id)).limit(12),
    ]);
    return Response.json({ patients: patientRows, employees: employeeRows });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const kind = clean(payload.kind);
    const db = getDb();

    if (kind === "patient") {
      const fullName = clean(payload.fullName);
      const fileNumber = clean(payload.fileNumber);
      const admissionDate = clean(payload.admissionDate);
      const department = clean(payload.department);
      const gender = clean(payload.gender);
      const entryType = clean(payload.entryType) || "استشارية";
      const initialPrice = Math.max(0, Number(payload.initialPrice) || getInitialPrice(entryType));
      const newbornCount = Math.max(0, Math.min(5, Number(payload.newbornCount) || 0));
      if (!fullName || !fileNumber || !admissionDate || !department || !gender) {
        return Response.json({ error: "يرجى إكمال الحقول الأساسية للمريضة" }, { status: 400 });
      }

      const [record] = await db.insert(patients).values({
        fullName,
        fileNumber,
        birthDate: clean(payload.birthDate) || null,
        gender,
        phone: clean(payload.phone) || null,
        admissionDate,
        department,
        attendingDoctor: clean(payload.attendingDoctor) || null,
        paymentCategory: clean(payload.paymentCategory) || "نقدي",
        entryType,
        billingMode: getBillingMode(entryType),
        notes: clean(payload.notes) || null,
      }).returning();

      const newbornNames = buildNewbornNames(fullName, newbornCount);
      for (const [index, newbornName] of newbornNames.entries()) {
        await db.insert(patients).values({
          fullName: newbornName,
          fileNumber: `${fileNumber}-N${index + 1}`,
          gender: "غير محدد",
          admissionDate,
          department: "حديثو الولادة",
          attendingDoctor: clean(payload.attendingDoctor) || null,
          paymentCategory: clean(payload.paymentCategory) || "نقدي",
          entryType: "مولود جديد",
          billingMode: "مرتبط بملف الأم",
          isNewborn: true,
          motherId: record.id,
          twinOrder: newbornCount > 1 ? index + 1 : null,
        });
      }

      await db.insert(patientEvents).values({
        patientId: record.id,
        eventType: entryType,
        amount: initialPrice,
      });
      return Response.json({ record: { ...record, newbornCount: newbornNames.length }, newbornNames }, { status: 201 });
    }

    if (kind === "employee") {
      const fullName = clean(payload.fullName);
      const employeeNumber = clean(payload.employeeNumber);
      const username = clean(payload.username);
      const role = clean(payload.role);
      const specialty = clean(payload.specialty);
      const joinDate = clean(payload.joinDate);
      if (!fullName || !employeeNumber || !username || !role || !specialty || !joinDate) {
        return Response.json({ error: "يرجى إكمال الحقول الأساسية للموظف" }, { status: 400 });
      }
      const [record] = await db.insert(employees).values({
        fullName,
        employeeNumber,
        username,
        phone: clean(payload.phone) || null,
        role,
        specialty,
        joinDate,
        maxConsultations: clean(payload.maxConsultations) ? Number(payload.maxConsultations) : null,
        dailyCap: clean(payload.dailyCap) ? Number(payload.dailyCap) : null,
        status: clean(payload.status) || "نشط",
      }).returning();
      return Response.json({ record }, { status: 201 });
    }

    return Response.json({ error: "نوع السجل غير مدعوم" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const action = clean(payload.action);
    const patientId = Number(payload.patientId);
    if (!Number.isInteger(patientId) || patientId <= 0) {
      return Response.json({ error: "معرّف المريضة غير صحيح" }, { status: 400 });
    }
    const db = getDb();

    if (action === "convert_to_inpatient") {
      await db.update(patientEvents).set({
        isInvalidated: true,
        invalidatedReason: "تم التحول إلى رقود",
      }).where(and(
        eq(patientEvents.patientId, patientId),
        inArray(patientEvents.eventType, ["ولادة طبيعية", "عملية قيصرية"]),
        eq(patientEvents.isInvalidated, false),
      ));
      const [patient] = await db.update(patients).set({
        entryType: "رقود",
        billingMode: "تراكمي",
      }).where(eq(patients.id, patientId)).returning();
      await db.insert(patientEvents).values({ patientId, eventType: "رقود", amount: 0 });
      return Response.json({ patient, message: "أُلغيت تسعيرة الولادة وبدأ احتساب الرقود التراكمي" });
    }

    if (action === "discharge") {
      const [patient] = await db.update(patients).set({
        patientStatus: "خرجت",
        dischargeDate: new Date().toISOString().slice(0, 10),
      }).where(eq(patients.id, patientId)).returning();
      await db.insert(patientEvents).values({ patientId, eventType: "خروج المريضة", amount: 0 });
      return Response.json({ patient, message: "أُغلق الملف بعد المراجعة النهائية" });
    }

    return Response.json({ error: "الانتقال المطلوب غير مدعوم" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
