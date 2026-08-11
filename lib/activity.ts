import { getSupabaseAdmin } from "./supabase-server";

type ActivityInput = {
  employeeName: string;
  activityType: string;
  description: string;
  entityType?: string | null;
  entityId?: string | number | null;
  source?: "web" | "telegram" | "admin" | "system";
  metadata?: Record<string, unknown>;
};

export async function recordEmployeeActivity(input: ActivityInput) {
  if (!input.employeeName.trim()) return;
  const { error } = await getSupabaseAdmin().rpc("record_employee_activity", {
    p_employee_name: input.employeeName.trim(),
    p_activity_type: input.activityType.trim(),
    p_description: input.description.trim(),
    p_entity_type: input.entityType?.trim() || null,
    p_entity_id: input.entityId === null || input.entityId === undefined ? null : String(input.entityId),
    p_source: input.source || "web",
    p_metadata: input.metadata || {},
  });
  if (error) throw error;
}

export async function recordEmployeeActivitySafely(input: ActivityInput) {
  try {
    await recordEmployeeActivity(input);
  } catch {
    // Activity logging must not undo a completed medical or administrative action.
  }
}
