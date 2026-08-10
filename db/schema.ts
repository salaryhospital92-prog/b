import { AnySQLiteColumn, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const patients = sqliteTable(
  "patients",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fullName: text("full_name").notNull(),
    fileNumber: text("file_number").notNull().unique(),
    birthDate: text("birth_date"),
    gender: text("gender").notNull(),
    phone: text("phone"),
    admissionDate: text("admission_date").notNull(),
    department: text("department").notNull(),
    attendingDoctor: text("attending_doctor"),
    paymentCategory: text("payment_category").notNull().default("نقدي"),
    entryType: text("entry_type").notNull().default("استشارية"),
    patientStatus: text("patient_status").notNull().default("نشط"),
    billingMode: text("billing_mode").notNull().default("مقطوعي"),
    isNewborn: integer("is_newborn", { mode: "boolean" }).notNull().default(false),
    motherId: integer("mother_id").references((): AnySQLiteColumn => patients.id),
    twinOrder: integer("twin_order"),
    dischargeDate: text("discharge_date"),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [index("idx_patients_created_at").on(table.createdAt)]
);

export const patientEvents = sqliteTable(
  "patient_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    patientId: integer("patient_id").notNull().references(() => patients.id),
    eventType: text("event_type").notNull(),
    amount: integer("amount").notNull().default(0),
    isInvalidated: integer("is_invalidated", { mode: "boolean" }).notNull().default(false),
    invalidatedReason: text("invalidated_reason"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_patient_events_patient_id").on(table.patientId),
    index("idx_patient_events_created_at").on(table.createdAt),
  ]
);

export const employees = sqliteTable(
  "employees",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fullName: text("full_name").notNull(),
    employeeNumber: text("employee_number").notNull().unique(),
    username: text("username").notNull().unique(),
    phone: text("phone"),
    role: text("role").notNull(),
    specialty: text("specialty").notNull(),
    joinDate: text("join_date").notNull(),
    maxConsultations: integer("max_consultations"),
    dailyCap: integer("daily_cap"),
    status: text("status").notNull().default("نشط"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_employees_created_at").on(table.createdAt),
    index("idx_employees_role").on(table.role),
  ]
);
