/**
 * Draws a whole month roster onto one canvas, in Albayati colours, so it can be
 * shared as a single image. Canvas 2D only — no libraries, no network.
 */

import { SHIFTS, weekdayName, type Assignment } from "./shift-planner";

export type RosterImageInput = {
  monthLabel: string;
  year: number;
  month: number;
  days: number;
  doctors: { id: number; fullName: string }[];
  assignments: Assignment[];
  morningStart: string;
  eveningStart: string;
  shiftHours: number;
  hospitalName?: string;
  /** Stamped on the image so a draft is never mistaken for the published roster. */
  watermark?: string;
};

const BRAND = {
  tealDark: "#0a5c53",
  teal: "#0f7569",
  ink: "#142b2b",
  muted: "#738381",
  line: "#dce9e3",
  surface: "#f4faf7",
  morningHead: "#e08a2e",
  morningCell: "#fdf1dd",
  morningInk: "#8a5d18",
  nightHead: "#101820",
  nightCell: "#e4ecf4",
  nightInk: "#24384f",
  weekend: "#e7f3ef",
};

const FONT = "'Segoe UI', 'Noto Naskh Arabic', 'Arial', sans-serif";
const ROW = 34;
const HEADER = 118;
const COL_DATE = 62;
const COL_WEEKDAY = 104;
const COL_SHIFT = 168;
const PADDING = 26;

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function loadIcon(source: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

export async function renderRosterImage(input: RosterImageInput, iconSource = "/icons/icon-192.png") {
  const doctorColumnWidth = Math.max(96, Math.min(150, 1180 / Math.max(1, input.doctors.length + 3)));
  const tableWidth = COL_DATE + COL_WEEKDAY + input.doctors.length * doctorColumnWidth + COL_SHIFT * 2;
  const summaryHeight = 54 + Math.ceil(input.doctors.length / 3) * 30;
  const width = tableWidth + PADDING * 2;
  const height = HEADER + ROW + input.days * ROW + summaryHeight + 54 + PADDING;

  const scale = 2; // retina-sharp when opened or shared on a phone
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("تعذر تجهيز الصورة على هذا المتصفح");
  context.scale(scale, scale);
  context.textBaseline = "middle";
  context.direction = "rtl";

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  // ---- branded header -------------------------------------------------
  const gradient = context.createLinearGradient(0, 0, width, HEADER);
  gradient.addColorStop(0, BRAND.tealDark);
  gradient.addColorStop(1, BRAND.teal);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, HEADER);

  const icon = await loadIcon(iconSource);
  const iconBox = 60;
  const iconX = width - PADDING - iconBox;
  if (icon) {
    context.save();
    roundRect(context, iconX, 29, iconBox, iconBox, 14);
    context.clip();
    context.drawImage(icon, iconX, 29, iconBox, iconBox);
    context.restore();
  } else {
    context.fillStyle = "rgba(255,255,255,.18)";
    roundRect(context, iconX, 29, iconBox, iconBox, 14);
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = `700 30px ${FONT}`;
    context.textAlign = "center";
    context.fillText("ب", iconX + iconBox / 2, 61);
  }

  context.textAlign = "right";
  context.fillStyle = "#ffffff";
  context.font = `700 27px ${FONT}`;
  context.fillText(input.hospitalName || "مقيمو مستشفى البياتي", iconX - 16, 50);
  context.font = `400 16px ${FONT}`;
  context.fillStyle = "rgba(255,255,255,.86)";
  context.fillText(`جدول المناوبات — ${input.monthLabel}`, iconX - 16, 76);

  context.textAlign = "left";
  context.font = `600 13px ${FONT}`;
  context.fillStyle = "rgba(255,255,255,.72)";
  context.fillText("نظام البياتي الطبي الذكي", PADDING, 50);
  context.font = `400 12px ${FONT}`;
  context.fillText(`مورنك ${input.morningStart} · نايت ${input.eveningStart} · ${input.shiftHours} ساعة`, PADDING, 74);

  // ---- table ----------------------------------------------------------
  // Columns are laid out right-to-left to match the printed hospital rota.
  const right = width - PADDING;
  const columns: { label: string; width: number; kind: "date" | "weekday" | "doctor" | "morning" | "night"; doctorId?: number }[] = [
    { label: "التاريخ", width: COL_DATE, kind: "date" },
    { label: "اليوم", width: COL_WEEKDAY, kind: "weekday" },
    ...input.doctors.map((doctor) => ({ label: doctor.fullName, width: doctorColumnWidth, kind: "doctor" as const, doctorId: doctor.id })),
    { label: "مورنك", width: COL_SHIFT, kind: "morning" as const },
    { label: "نايت", width: COL_SHIFT, kind: "night" as const },
  ];
  const edges: number[] = [];
  let cursor = right;
  for (const column of columns) { edges.push(cursor); cursor -= column.width; }
  edges.push(cursor);

  const headTop = HEADER + 12;
  context.textAlign = "center";
  columns.forEach((column, index) => {
    const columnRight = edges[index];
    const x = columnRight - column.width;
    context.fillStyle = column.kind === "morning" ? BRAND.morningHead : column.kind === "night" ? BRAND.nightHead : "#243342";
    context.fillRect(x, headTop, column.width, ROW);
    context.fillStyle = "#ffffff";
    context.font = `700 13px ${FONT}`;
    context.fillText(column.label, x + column.width / 2, headTop + ROW / 2);
  });

  const byDay = new Map<number, Assignment[]>();
  for (const assignment of input.assignments) {
    byDay.set(assignment.day, [...(byDay.get(assignment.day) || []), assignment]);
  }

  for (let day = 1; day <= input.days; day += 1) {
    const y = headTop + ROW + (day - 1) * ROW;
    const weekdayIndex = new Date(Date.UTC(input.year, input.month - 1, day)).getUTCDay();
    const isWeekend = weekdayIndex === 5 || weekdayIndex === 6;
    const onDuty = byDay.get(day) || [];

    columns.forEach((column, index) => {
      const x = edges[index] - column.width;
      let background = day % 2 === 0 ? BRAND.surface : "#ffffff";
      let text = "";
      let colour = BRAND.ink;
      let weight = "400";

      if (column.kind === "date") { background = isWeekend ? BRAND.weekend : "#eef4f1"; text = String(day); weight = "700"; }
      else if (column.kind === "weekday") { background = isWeekend ? BRAND.weekend : "#eef4f1"; text = weekdayName(input.year, input.month, day); colour = BRAND.muted; }
      else if (column.kind === "doctor") {
        const shift = onDuty.find((item) => item.employeeId === column.doctorId);
        if (shift) {
          background = shift.shift === "صباحية" ? BRAND.morningCell : BRAND.nightCell;
          colour = shift.shift === "صباحية" ? BRAND.morningInk : BRAND.nightInk;
          text = shift.fullName;
          weight = "700";
        }
      } else {
        const shiftName = column.kind === "morning" ? SHIFTS[0] : SHIFTS[1];
        const names = onDuty.filter((item) => item.shift === shiftName).map((item) => item.fullName);
        text = names.join("، ") || "—";
        colour = names.length ? BRAND.ink : "#b9c7c2";
        weight = names.length ? "600" : "400";
      }

      context.fillStyle = background;
      context.fillRect(x, y, column.width, ROW);
      context.strokeStyle = BRAND.line;
      context.lineWidth = 1;
      context.strokeRect(x + 0.5, y + 0.5, column.width - 1, ROW - 1);
      if (!text) return;
      context.fillStyle = colour;
      context.font = `${weight} 12px ${FONT}`;
      let label = text;
      while (context.measureText(label).width > column.width - 10 && label.length > 3) label = `${label.slice(0, -2)}…`;
      context.fillText(label, x + column.width / 2, y + ROW / 2);
    });
  }

  // ---- per-doctor totals: the quick read a chief actually wants --------
  const summaryTop = headTop + ROW + input.days * ROW + 18;
  context.textAlign = "right";
  context.fillStyle = BRAND.ink;
  context.font = `700 15px ${FONT}`;
  context.fillText("إجمالي المناوبات لكل طبيب", right, summaryTop + 8);

  const totals = input.doctors.map((doctor) => {
    const mine = input.assignments.filter((item) => item.employeeId === doctor.id);
    return {
      name: doctor.fullName,
      total: mine.length,
      morning: mine.filter((item) => item.shift === "صباحية").length,
      evening: mine.filter((item) => item.shift === "مسائية").length,
    };
  });
  const chipWidth = (tableWidth - 20) / 3;
  totals.forEach((entry, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = right - (column + 1) * chipWidth - column * 5;
    const y = summaryTop + 26 + row * 30;
    context.fillStyle = BRAND.surface;
    roundRect(context, x, y, chipWidth, 25, 8);
    context.fill();
    context.fillStyle = BRAND.ink;
    context.font = `700 12px ${FONT}`;
    context.fillText(entry.name, x + chipWidth - 10, y + 13);
    context.fillStyle = BRAND.muted;
    context.font = `400 11px ${FONT}`;
    context.textAlign = "left";
    context.fillText(`${entry.total} مناوبة · مورنك ${entry.morning} · نايت ${entry.evening}`, x + 10, y + 13);
    context.textAlign = "right";
  });

  const footTop = summaryTop + 26 + Math.ceil(totals.length / 3) * 30 + 14;
  context.fillStyle = BRAND.muted;
  context.font = `400 11px ${FONT}`;
  context.fillText(`صادر عن نظام البياتي الطبي الذكي · ${input.assignments.length} مناوبة موزعة`, right, footTop);

  if (input.watermark) {
    context.save();
    context.translate(width / 2, height / 2);
    context.rotate(-Math.PI / 9);
    context.textAlign = "center";
    context.fillStyle = "rgba(15,117,105,.10)";
    context.font = `800 82px ${FONT}`;
    context.fillText(input.watermark, 0, 0);
    context.restore();
  }

  return canvas;
}

export async function rosterImageBlob(input: RosterImageInput, iconSource?: string) {
  const canvas = await renderRosterImage(input, iconSource);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("تعذر إنشاء الصورة")), "image/png");
  });
}
