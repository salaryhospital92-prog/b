import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { employees, patients } from "../../../db/schema";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "تعذر حفظ السجل";
  if (message.includes("UNIQUE constraint failed")) {
    return "رقم الملف أو اسم المستخدم مسجل مسبقًا";
  }
  if (message.includes("no such table")) {
    return "قاعدة التسجيل قيد التجهيز، حاول مرة أخرى بعد قليل";
  }
  return message;
}

export async function GET() {
  try {
    const db = getDb();
    const [patientRows, employeeRows] = await Promise.all([
      db.select().from(patients).orderBy(desc(patients.createdAt), desc(patients.id)).limit(12),
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
      if (!fullName || !fileNumber || !admissionDate || !department || !gender) {
        return Response.json({ error: "يرجى إكمال الحقول الأساسية للمريض" }, { status: 400 });
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
        notes: clean(payload.notes) || null,
      }).returning();
      return Response.json({ record }, { status: 201 });
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
