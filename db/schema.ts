import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [index("idx_patients_created_at").on(table.createdAt)]
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
