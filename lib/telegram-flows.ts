import { getSupabaseAdmin } from "./supabase-server";
import { stepHint, stepKeyboard, type FlowOption } from "./telegram-buttons";
import type { TelegramReplyMarkup } from "./telegram";

export type { FlowOption };

export type FlowContext = {
  employeeId: number;
  fullName: string;
  role: string;
  isBotAdmin: boolean;
  data: Record<string, unknown>;
};

export type FlowStep = {
  key: string;
  prompt: string;
  kind: "choice" | "multi" | "text" | "file";
  options?: (context: FlowContext) => Promise<FlowOption[]>;
  /** A choice step that also accepts a typed answer (e.g. a custom file number). */
  allowText?: boolean;
  optional?: boolean;
};

export type Flow = {
  title: string;
  steps: FlowStep[];
  finish: (context: FlowContext) => Promise<string>;
};

export type FlowSession = {
  flow: string;
  step: number;
  data: Record<string, unknown>;
  options: FlowOption[];
};

export type FlowReply = { text: string; replyMarkup?: TelegramReplyMarkup; finished?: boolean };

export type FlowInput =
  | { kind: "index"; index: number }
  | { kind: "text"; text: string }
  | { kind: "file"; file: Record<string, unknown> }
  | { kind: "skip" }
  | { kind: "done" }
  | { kind: "cancel" };

async function renderStep(flow: Flow, stepIndex: number, context: FlowContext) {
  const step = flow.steps[stepIndex];
  const options = step.options ? await step.options(context) : [];
  const selected = Array.isArray(context.data[step.key]) ? (context.data[step.key] as string[]) : [];
  const header = `${flow.title} — خطوة ${stepIndex + 1} من ${flow.steps.length}`;
  return {
    options,
    reply: {
      text: `${header}\n\n${step.prompt}${stepHint(step)}`,
      replyMarkup: stepKeyboard(step, options, selected),
    } satisfies FlowReply,
  };
}

export async function loadSession(chatId: number): Promise<FlowSession | null> {
  const { data, error } = await getSupabaseAdmin().from("telegram_sessions")
    .select("flow,step,data,options").eq("chat_id", chatId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    flow: String(data.flow),
    step: Number(data.step),
    data: (data.data || {}) as Record<string, unknown>,
    options: (data.options || []) as FlowOption[],
  };
}

export async function clearSession(chatId: number) {
  const { error } = await getSupabaseAdmin().from("telegram_sessions").delete().eq("chat_id", chatId);
  if (error) throw error;
}

async function saveSession(chatId: number, telegramUserId: number, context: FlowContext, session: FlowSession) {
  const { error } = await getSupabaseAdmin().from("telegram_sessions").upsert({
    chat_id: chatId,
    telegram_user_id: telegramUserId,
    employee_id: context.employeeId,
    flow: session.flow,
    step: session.step,
    data: session.data,
    options: session.options,
  }, { onConflict: "chat_id" });
  if (error) throw error;
}

export async function startFlow(
  chatId: number,
  telegramUserId: number,
  flowName: string,
  flow: Flow,
  context: FlowContext,
): Promise<FlowReply> {
  context.data = {};
  const { options, reply } = await renderStep(flow, 0, context);
  await saveSession(chatId, telegramUserId, context, { flow: flowName, step: 0, data: {}, options });
  return reply;
}

/**
 * Applies one answer to the running flow and returns what to send back.
 * Returns null when the input does not belong to the current step, so the
 * caller can fall back to normal command handling.
 */
export async function applyFlowInput(
  chatId: number,
  telegramUserId: number,
  flow: Flow,
  session: FlowSession,
  context: FlowContext,
  input: FlowInput,
): Promise<FlowReply | null> {
  const step = flow.steps[session.step];
  if (!step) {
    await clearSession(chatId);
    return { text: "انتهت الجلسة. اضغط «قائمة الأوامر» للبدء من جديد.", finished: true };
  }
  context.data = session.data;

  if (input.kind === "cancel") {
    await clearSession(chatId);
    return { text: `تم إلغاء «${flow.title}». لم يُحفظ أي شيء.`, finished: true };
  }

  if (input.kind === "done") {
    if (step.kind !== "multi") return null;
    const selected = Array.isArray(session.data[step.key]) ? (session.data[step.key] as string[]) : [];
    if (!selected.length) return { text: "اختر عنصرًا واحدًا على الأقل قبل المتابعة.", replyMarkup: stepKeyboard(step, session.options, selected) };
    return advance(chatId, telegramUserId, flow, session, context);
  }

  if (input.kind === "skip") {
    if (!step.optional) return null;
    session.data[step.key] = "";
    return advance(chatId, telegramUserId, flow, session, context);
  }

  if (input.kind === "index") {
    if (step.kind !== "choice" && step.kind !== "multi") return null;
    const option = session.options[input.index];
    if (!option) return { text: "هذا الخيار لم يعد متاحًا. اضغط «إلغاء» وابدأ من جديد." };
    if (step.kind === "multi") {
      const selected = Array.isArray(session.data[step.key]) ? (session.data[step.key] as string[]) : [];
      const next = selected.includes(option.value) ? selected.filter((value) => value !== option.value) : [...selected, option.value];
      session.data[step.key] = next;
      await saveSession(chatId, telegramUserId, context, session);
      return { text: `${flow.title} — خطوة ${session.step + 1} من ${flow.steps.length}\n\n${step.prompt}${stepHint(step)}`, replyMarkup: stepKeyboard(step, session.options, next) };
    }
    session.data[step.key] = option.value;
    return advance(chatId, telegramUserId, flow, session, context);
  }

  if (input.kind === "text") {
    if (step.kind !== "text" && !step.allowText) return null;
    const value = input.text.trim();
    if (!value) return { text: "الإجابة فارغة. أرسل نصًا صحيحًا أو اضغط «إلغاء»." };
    session.data[step.key] = value;
    return advance(chatId, telegramUserId, flow, session, context);
  }

  if (step.kind !== "file") return null;
  session.data[step.key] = input.file;
  return advance(chatId, telegramUserId, flow, session, context);
}

async function advance(
  chatId: number,
  telegramUserId: number,
  flow: Flow,
  session: FlowSession,
  context: FlowContext,
): Promise<FlowReply> {
  const nextStep = session.step + 1;
  if (nextStep >= flow.steps.length) {
    await clearSession(chatId);
    return { text: await flow.finish(context), finished: true };
  }
  session.step = nextStep;
  const { options, reply } = await renderStep(flow, nextStep, context);
  session.options = options;
  await saveSession(chatId, telegramUserId, context, session);
  return reply;
}
