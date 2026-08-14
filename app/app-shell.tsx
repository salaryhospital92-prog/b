"use client";

import { FormEvent, useEffect, useMemo, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { buildNewbornNames, getInitialPrice, isBirthEntry, MAX_NEWBORNS } from "../lib/rules-engine";
import { getSupabaseBrowser } from "../lib/supabase-browser";
import LoginLanding from "./login-landing";
import ResidentWorkflow from "./resident-workflow";
import ShiftSchedule from "./shift-schedule";
import InpatientDays from "./inpatient-days";
import AccountMenu from "./account-menu";
import IssueAccount from "./issue-account";

type Role = "doctor" | "chief" | "accounts" | "admin" | "developer";
type DemoAccount = { id: string; role: Role; label: string; name: string; username: string; department: string };
type View = "overview" | "handover" | "days" | "workLogs" | "objections" | "audit" | "payments" | "reports" | "settings" | "registry" | "personalSalary" | "capabilities" | "accessRequests" | "attendance" | "shifts" | "inpatientDays";
type Toast = { message: string; kind: "success" | "info" } | null;
type PatientRecord = { id: number; fullName: string; fileNumber: string; department: string; admissionDate: string; paymentCategory: string; entryType: string; patientStatus: string; billingMode: string; attendingDoctor?: string | null; isNewborn?: boolean; newbornCount?: number };
type EmployeeRecord = { id: number; fullName: string; employeeNumber: string; role: string; specialty: string; status: string };
type HandoverPatient = { id: number; priority: string; clinicalSummary: string; pendingActions: string; receivedStatus: string; patient: PatientRecord };
type HandoverRecord = { id: number; fromDoctorName: string; toDoctorName: string; status: string; notes?: string | null; shiftEndedAt: string; acceptedAt?: string | null; patients: HandoverPatient[] };
type ReportData = {
  range: { start: string; end: string };
  summary: { patients: number; newborns: number; birthCases: number; expenses: number; salaries: number; revenue: number; net: number; acceptedHandovers: number; receivedPatients: number; paidInpatientDays: number; pendingPayments: number; freeInpatientDays: number; activePatients: number };
  topDoctors: { name: string; patientsReceived: number }[];
  dailySeries: { date: string; patients: number; births: number; revenue: number; expenses: number; salaries: number }[];
  generatedAt: string;
};
type AccessRequestRecord = { id: number; fullName: string; email: string; provider: "email" | "google" | "apple"; requestedRole: string; specialty: string; status: string; requestedAt: string };
type AccessDraft = { fullName: string; requestedRole: string; specialty: string };
type DoctorDay = { id: number; day: string; date: string; status: string; amount: number; tone: "approved" | "pending" | "returned"; details: string };
type DoctorProfile = {
  firstName: string;
  currentSalary: number;
  previousSalary: number;
  growth: number;
  consultationAmount: number;
  consultationCount: number;
  procedureAmount: number;
  operationCount: number;
  inpatientCount: number;
  bars: number[];
  days: DoctorDay[];
  insight: string;
  highlight: string;
  alertTitle: string;
  alertBody: string;
};
type GlobalSearchResult = { id: string; kind: "account" | "patient" | "view"; label: string; meta: string; target: string };
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type PresenceRecord = { employeeId: number; fullName: string; role: string; specialty: string; isPresent: boolean; attendanceSessionId?: number | null; clockInAt?: string | null; clockInSource?: string | null; lastActivityType?: string | null; lastActivity?: string | null; lastActivitySource?: string | null; lastActivityAt?: string | null; telegramStatus?: string | null; telegramUsername?: string | null; telegramLastSeenAt?: string | null };
type AttendanceSession = { id: number; employeeId: number; employeeName: string; clockInAt: string; clockOutAt?: string | null; clockInSource: string; clockOutSource?: string | null };
type OperationalTask = { id: number; title: string; status: string; priority: string; dueAt?: string | null; assigneeName: string };
type AttendanceData = { summary: { present: number; total: number; arrivalsToday: number; activeLast15Minutes: number; openTasks: number }; presence: PresenceRecord[]; sessions: AttendanceSession[]; tasks: OperationalTask[] };
type TelegramStatusData = { botUsername: string; configuration: { tokenConfigured: boolean; secretConfigured: boolean; publicUrlConfigured: boolean; webhookReady: boolean }; linkedAccounts: { id: number; employeeId: number; employeeName: string; employeeRole: string; username?: string | null; status: string; isBotAdmin: boolean; pairedAt: string; lastSeenAt: string }[]; recentUpdates: { updateId: number; employeeName?: string | null; command?: string | null; status: string; error?: string | null; receivedAt: string; processedAt?: string | null }[]; openTasks: number; botAdmins: { employeeName: string; username?: string | null; lastSeenAt: string }[]; pendingAdminRequests: { id: number; username?: string | null; displayName?: string | null; requestedAt: string }[]; bootstrapAdmins: { employeeName: string; username?: string | null; phoneNumber: string; status: string; verifiedAt?: string | null }[] };
type TelegramLink = { code: string; employeeName: string; expiresAt: string; deepLink: string } | null;
type ReadmissionCandidate = { newbornId: number; newbornName: string; newbornFileNumber: string; twinOrder: number | null; dischargeDate: string | null; motherId: number; motherName: string; motherFileNumber: string };

const IQD = new Intl.NumberFormat("en-US");
const money = (value: number) => `${IQD.format(value)} د.ع`;
const ADMIN_REPORT_URL = "/reports/albayati-admin-august-2026.xlsx";

const recentDays: DoctorDay[] = [];

function emptyDoctorProfile(firstName: string): DoctorProfile {
  return {
    firstName,
    currentSalary: 0,
    previousSalary: 0,
    growth: 0,
    consultationAmount: 0,
    consultationCount: 0,
    procedureAmount: 0,
    operationCount: 0,
    inpatientCount: 0,
    bars: Array(12).fill(4),
    days: [],
    insight: "الحساب جاهز لبدء تسجيل أول مناوبة.",
    highlight: "ستظهر التحليلات بعد إضافة بيانات حقيقية.",
    alertTitle: "لا توجد تنبيهات",
    alertBody: "جميع البيانات التشغيلية تبدأ من الصفر.",
  };
}

const doctorProfiles: Record<string, DoctorProfile> = {
  "doctor-fanar": emptyDoctorProfile("فنار"),
  "doctor-tabarak": emptyDoctorProfile("تبارك"),
  "doctor-shahd": emptyDoctorProfile("شهد"),
};

const auditSeed: { id: number; doctor: string; avatar: string; date: string; procedures: string; entered: number; cap: number; over: boolean; wait: string }[] = [];
const paymentSeed: { id: number; patient: string; file: string; admission: string; days: string[] }[] = [];

// Presentation only — which screens a role sees. Credentials live in the
// database and are checked by the server; none of this identifies anyone.
const demoAccounts: DemoAccount[] = [
  { id: "admin-mustafa", role: "admin", label: "الإدارة العليا", name: "مصطفى البياتي", username: "mustafa", department: "رئاسة القسم" },
  { id: "doctor-shahd", role: "doctor", label: "طبيب مقيم", name: "د. شهد", username: "shahd", department: "الردهة والرقود" },
  { id: "doctor-tabarak", role: "doctor", label: "طبيب مقيم", name: "د. تبارك", username: "tabarak", department: "الاستشارية" },
  { id: "doctor-fanar", role: "doctor", label: "طبيب مقيم", name: "د. فنار", username: "fanar", department: "صالة الولادة" },
  { id: "developer-system", role: "developer", label: "مطور النظام · معاينة جميع الحسابات", name: "Admin", username: "Admin", department: "إدارة النظام" },
];

/** Maps the signed-in employee onto the screen set their job needs. */
function accountForUser(user: { username: string; fullName: string; role: string }) {
  const byName = demoAccounts.find((account) => account.name === user.fullName);
  const byUsername = demoAccounts.find((account) => account.username.toLowerCase() === user.username.toLowerCase());
  if (byName || byUsername) return byName || byUsername!;
  const role: DemoAccount["role"] = user.role === "الإدارة العليا" ? "admin"
    : user.role === "رئيس المقيمين" ? "chief"
    : user.role === "الحسابات" ? "accounts"
    : user.role === "مطور النظام" ? "developer"
    : "doctor";
  return { id: `employee-${user.username}`, role, label: user.role, name: user.fullName, username: user.username, department: user.role };
}

const VIEW_PATHS: Record<View, string> = {
  overview: "/dashboard",
  attendance: "/attendance",
  registry: "/registry",
  handover: "/handover",
  shifts: "/shifts",
  inpatientDays: "/inpatient-days",
  days: "/resident-days",
  workLogs: "/work-logs",
  objections: "/objections",
  audit: "/audit",
  payments: "/payments",
  reports: "/reports",
  personalSalary: "/salary",
  settings: "/settings",
  accessRequests: "/access-requests",
  capabilities: "/capabilities",
};
const VIEW_ORDER = Object.keys(VIEW_PATHS) as View[];
const PATH_VIEWS: Record<string, View> = Object.fromEntries(
  Object.entries(VIEW_PATHS).map(([view, path]) => [path, view as View]),
) as Record<string, View>;

function viewForPath(pathname: string): View {
  return PATH_VIEWS[pathname.replace(/\/+$/, "") || "/"] ?? "overview";
}

function Icon({ children }: { children: string }) {
  return <span className="nav-icon" aria-hidden="true">{children}</span>;
}

function Sparkline({ bars = [42, 56, 38, 68, 52, 76, 64, 86, 72, 92, 78, 96] }: { bars?: number[] }) {
  return (
    <div className="sparkline" aria-label="نمو الراتب خلال الشهر">
      {bars.map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}
    </div>
  );
}

function StatusPill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`status ${tone}`}><i />{children}</span>;
}

type SessionUser = { id: number; fullName: string; role: string; specialty: string; username: string; mustChangePassword: boolean };

export default function Home({ initialUser }: { initialUser: SessionUser | null }) {
  const [signedIn, setSignedIn] = useState(Boolean(initialUser));
  const [activeAccountId, setActiveAccountId] = useState(() => initialUser ? accountForUser(initialUser).id : "admin-mustafa");
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(initialUser);
  const pathname = usePathname();
  const [view, setView] = useState<View>(() => viewForPath(pathname));
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [auditRows, setAuditRows] = useState(auditSeed);
  const [payments, setPayments] = useState(paymentSeed);
  const [toast, setToast] = useState<Toast>(null);
  const [auditFilter, setAuditFilter] = useState("الكل");
  const [search, setSearch] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installGuide, setInstallGuide] = useState<"ios" | "android" | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [registryTab, setRegistryTab] = useState<"patient" | "employee">("patient");
  const [registrySaving, setRegistrySaving] = useState(false);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [registeredPatients, setRegisteredPatients] = useState<PatientRecord[]>([]);
  const [registeredEmployees, setRegisteredEmployees] = useState<EmployeeRecord[]>([]);
  const [employeeRole, setEmployeeRole] = useState("طبيب مقيم");
  const [patientName, setPatientName] = useState("");
  const [patientEntryType, setPatientEntryType] = useState("استشارية");
  const [newbornCount, setNewbornCount] = useState(0);
  const [patientInitialPrice, setPatientInitialPrice] = useState<number>(getInitialPrice("استشارية"));
  const [handoverLoading, setHandoverLoading] = useState(true);
  const [handoverSaving, setHandoverSaving] = useState(false);
  const [handover, setHandover] = useState<HandoverRecord | null>(null);
  const [handoverCandidates, setHandoverCandidates] = useState<PatientRecord[]>([]);
  const [selectedPatientIds, setSelectedPatientIds] = useState<number[]>([]);
  const [handoverFromDoctor, setHandoverFromDoctor] = useState("د. شهد");
  const [handoverToDoctor, setHandoverToDoctor] = useState("د. تبارك");
  const [reportPeriod, setReportPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reportLoading, setReportLoading] = useState(true);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessRequests, setAccessRequests] = useState<AccessRequestRecord[]>([]);
  const [accessLoading, setAccessLoading] = useState(true);
  const [attendanceData, setAttendanceData] = useState<AttendanceData | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceSaving, setAttendanceSaving] = useState<number | null>(null);
  const [attendanceFilter, setAttendanceFilter] = useState("");
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatusData | null>(null);
  const [telegramLink, setTelegramLink] = useState<TelegramLink>(null);
  const [readmissionCandidates, setReadmissionCandidates] = useState<ReadmissionCandidate[]>([]);
  const [readmissionMotherId, setReadmissionMotherId] = useState(0);
  const [readmissionNewbornId, setReadmissionNewbornId] = useState(0);
  const [readmissionSaving, setReadmissionSaving] = useState(false);

  const isDeveloper = sessionUser?.role === "مطور النظام";
  // Only the developer account may preview another role; everyone else is
  // pinned to the identity the server signed them in as.
  const currentRole = isDeveloper
    ? (demoAccounts.find((item) => item.id === activeAccountId) || demoAccounts[0])
    : sessionUser ? accountForUser(sessionUser) : demoAccounts[0];
  const role = currentRole.role;
  const doctorProfile = doctorProfiles[activeAccountId] || doctorProfiles["doctor-fanar"];
  const isBirthCase = isBirthEntry(patientEntryType);
  const newbornNames = buildNewbornNames(patientName, newbornCount);
  const readmissionMothers = [...new Map(readmissionCandidates.map((row) => [row.motherId, row])).values()];
  const readmissionNewborns = readmissionCandidates.filter((row) => row.motherId === readmissionMotherId);

  const navItems = useMemo(() => {
    if (role === "doctor") return [
      { id: "overview" as View, label: "الرئيسية", icon: "⌂" },
      { id: "handover" as View, label: "استلام المناوبة", icon: "⇄" },
      { id: "registry" as View, label: "تسجيل مريض", icon: "✚" },
      { id: "shifts" as View, label: "جدول المناوبات", icon: "◷" },
      { id: "workLogs" as View, label: "سجل المناوبات", icon: "▤" },
      { id: "objections" as View, label: "اعتراضاتي", icon: "!" },
      { id: "inpatientDays" as View, label: "أيام الرقود", icon: "▣" },
      { id: "reports" as View, label: "كشف الحساب", icon: "▥" },
    ];
    if (role === "chief") return [
      { id: "overview" as View, label: "الرئيسية", icon: "⌂" },
      { id: "handover" as View, label: "تسليم المناوبات", icon: "⇄" },
      { id: "shifts" as View, label: "جدول المناوبات", icon: "◷" },
      { id: "workLogs" as View, label: "سجلات الأطباء", icon: "▤" },
      { id: "objections" as View, label: "الاعتراضات", icon: "!" },
      { id: "inpatientDays" as View, label: "أيام الرقود", icon: "▣" },
      { id: "personalSalary" as View, label: "راتبي الشخصي", icon: "◇" },
      { id: "audit" as View, label: "التدقيق والاعتماد", icon: "✓" },
      { id: "accessRequests" as View, label: "إدارة الحسابات", icon: "♙" },
      { id: "settings" as View, label: "سقوف الأطباء", icon: "⚙" },
      { id: "reports" as View, label: "التقارير", icon: "▥" },
      { id: "capabilities" as View, label: "دليل الصلاحيات", icon: "؟" },
    ];
    if (role === "accounts") return [
      { id: "overview" as View, label: "الرئيسية", icon: "⌂" },
      { id: "registry" as View, label: "تسجيل مريض", icon: "✚" },
      { id: "workLogs" as View, label: "سجلات المناوبات", icon: "▤" },
      { id: "payments" as View, label: "حالات الدفع", icon: "¤" },
      { id: "inpatientDays" as View, label: "أيام الرقود والخدج", icon: "▣" },
      { id: "reports" as View, label: "المطابقات", icon: "▥" },
      { id: "capabilities" as View, label: "دليل المهام", icon: "؟" },
    ];
    if (role === "admin") return [
      { id: "overview" as View, label: "لوحة القيادة", icon: "⌂" },
      { id: "attendance" as View, label: "الحضور والنشاط", icon: "◉" },
      { id: "shifts" as View, label: "جدول المناوبات", icon: "◷" },
      { id: "registry" as View, label: "مركز التسجيل", icon: "✚" },
      { id: "workLogs" as View, label: "سجلات المناوبات", icon: "▤" },
      { id: "reports" as View, label: "التقارير الشاملة", icon: "▥" },
      { id: "payments" as View, label: "البحث عن مريض", icon: "⌕" },
      { id: "inpatientDays" as View, label: "أيام الرقود والخدج", icon: "▣" },
      { id: "settings" as View, label: "إدارة النظام", icon: "⚙" },
      { id: "capabilities" as View, label: "دليل الصلاحيات", icon: "؟" },
    ];
    return [
      { id: "overview" as View, label: "حالة النظام", icon: "⌂" },
      { id: "attendance" as View, label: "الحضور وبوت البياتي", icon: "◉" },
      { id: "workLogs" as View, label: "سجل التعديلات", icon: "▤" },
      { id: "reports" as View, label: "مراقبة التقارير", icon: "▥" },
      { id: "settings" as View, label: "إعدادات النظام", icon: "⚙" },
      { id: "capabilities" as View, label: "صلاحيات المطور", icon: "؟" },
    ];
  }, [role]);

  // The four the thumb can reach; the pill animates between exactly these.
  const mobileTabs = useMemo(() => navItems.slice(0, 4), [navItems]);

  const globalSearchResults = useMemo<GlobalSearchResult[]>(() => {
    const normalize = (value: string) => value.trim().toLocaleLowerCase("ar").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي");
    const query = normalize(globalSearch);
    if (query.length < 2) return [];
    const accountResults = demoAccounts
      .filter((item) => normalize(`${item.name} ${item.label}`).includes(query))
      .map((item) => ({ id: `account-${item.id}`, kind: "account" as const, label: item.name, meta: item.label, target: item.id }));
    const patientResults = [...paymentSeed.map((item) => ({ fullName: item.patient, fileNumber: item.file })), ...registeredPatients]
      .filter((item, index, list) => list.findIndex((candidate) => candidate.fileNumber === item.fileNumber) === index)
      .filter((item) => normalize(`${item.fullName} ${item.fileNumber}`).includes(query))
      .map((item) => ({ id: `patient-${item.fileNumber}`, kind: "patient" as const, label: item.fullName, meta: `ملف ${item.fileNumber}`, target: item.fullName }));
    const viewResults = navItems
      .filter((item) => normalize(item.label).includes(query))
      .map((item) => ({ id: `view-${item.id}`, kind: "view" as const, label: item.label, meta: "قسم في النظام", target: item.id }));
    return [...accountResults, ...patientResults, ...viewResults].slice(0, 8);
  }, [globalSearch, navItems, registeredPatients]);

  useEffect(() => {
    if (view !== "registry") return;
    let active = true;
    fetch(`/api/registry?actorName=${encodeURIComponent(currentRole.name)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "تعذر تحميل سجلات التسجيل");
        if (active) {
          setRegisteredPatients(data.patients ?? []);
          setRegisteredEmployees(data.employees ?? []);
          setReadmissionCandidates(data.readmissionCandidates ?? []);
        }
      })
      .catch(() => {
        if (active) notify("سيتم عرض السجلات فور اكتمال تهيئة قاعدة البيانات", "info");
      })
      .finally(() => active && setRegistryLoading(false));
    return () => { active = false; };
  }, [view, currentRole.name]);

  useEffect(() => {
    if (view !== "handover") return;
    let active = true;
    fetch(`/api/handover?actorName=${encodeURIComponent(currentRole.name)}`)
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
  }, [view, currentRole.name]);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("albayati-theme");
    document.documentElement.dataset.theme = savedTheme === "dark" ? "dark" : "light";
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view, activeAccountId, signedIn]);

  useEffect(() => {
    const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
    const statusTimer = window.setTimeout(() => {
      setIsInstalled(window.matchMedia("(display-mode: standalone)").matches || standaloneNavigator.standalone === true);
      setNotificationPermission("Notification" in window ? Notification.permission : "unsupported");
    }, 0);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const markInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.clearTimeout(statusTimer);
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  useEffect(() => {
    if (view !== "reports") return;
    let active = true;
    fetch(`/api/reports?period=${reportPeriod}&date=${reportDate}&actorName=${encodeURIComponent(currentRole.name)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "تعذر تحميل التقرير");
        if (active) setReportData(data);
      })
      .catch((error) => active && notify(error instanceof Error ? error.message : "تعذر تحميل التقرير", "info"))
      .finally(() => active && setReportLoading(false));
    return () => { active = false; };
  }, [view, reportPeriod, reportDate, currentRole.name]);

  useEffect(() => {
    if (view !== "accessRequests" || role !== "chief") return;
    let active = true;
    fetch("/api/access-requests")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "تعذر تحميل طلبات الحسابات");
        if (active) setAccessRequests(data.requests || []);
      })
      .catch((error) => active && notify(error instanceof Error ? error.message : "تعذر تحميل طلبات الحسابات", "info"))
      .finally(() => active && setAccessLoading(false));
    return () => { active = false; };
  }, [view, role]);

  useEffect(() => {
    if (view !== "attendance" || !["admin", "developer"].includes(role)) return;
    let active = true;
    const actorQuery = `?actorName=${encodeURIComponent(currentRole.name)}`;
    Promise.all([
      fetch(`/api/attendance${actorQuery}`, { cache: "no-store" }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "تعذر تحميل سجل الحضور");
        return data as AttendanceData;
      }),
      fetch(`/api/telegram/status${actorQuery}`, { cache: "no-store" }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "تعذر تحميل حالة البوت");
        return data as TelegramStatusData;
      }),
    ]).then(([attendance, bot]) => {
      if (!active) return;
      setAttendanceData(attendance);
      setTelegramStatus(bot);
    }).catch((error) => active && notify(error instanceof Error ? error.message : "تعذر تحميل مركز العمليات", "info"))
      .finally(() => active && setAttendanceLoading(false));
    return () => { active = false; };
  }, [view, role, currentRole.name]);

  useEffect(() => {
    let active = true;
    getSupabaseBrowser().then(async (supabase) => {
      const { data } = await supabase.auth.getSession();
      const stored = window.localStorage.getItem("albayati-access-draft");
      if (!active || !data.session || !stored) return;
      const draft = JSON.parse(stored) as AccessDraft;
      const response = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify(draft),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "تعذر تسجيل طلب الحساب");
      window.localStorage.removeItem("albayati-access-draft");
      notify("تم تسجيل طلبك، وسيظهر لرئيس المقيمين للموافقة", "success");
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  function changeAccount(nextAccountId: string) {
    setActiveAccountId(nextAccountId);
    setView("overview");
    setSidebarExpanded(false);
  }

  // Coming back from Google, Apple, or an emailed link: exchange the proof for
  // a session, or offer to set a password when the link was a reset.
  useEffect(() => {
    if (signedIn && !window.location.search.includes("reset=1")) return;
    let active = true;
    (async () => {
      try {
        const supabase = await getSupabaseBrowser();
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken || !active) return;
        if (new URLSearchParams(window.location.search).get("reset") === "1") {
          setResetToken(accessToken);
          return;
        }
        const response = await fetch("/api/auth/oauth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken }),
        });
        const payload = await response.json();
        if (!active) return;
        if (response.ok) {
          await supabase.auth.signOut();
          applySession(payload.user);
        } else {
          notify(payload.error || "تعذر تسجيل الدخول", "info");
          if (payload.needsRequest) setAccessOpen(true);
        }
      } catch { /* no external session waiting */ }
    })();
    return () => { active = false; };
  }, [signedIn]);

  useEffect(() => {
    function onPopState() {
      const next = viewForPath(window.location.pathname);
      setView(next);
      if (window.location.pathname === "/") setSignedIn(false);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  async function signIn(username: string, password: string, remember = true): Promise<string | null> {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, remember }),
      });
      const payload = await response.json();
      if (!response.ok) return payload.error || "تعذر تسجيل الدخول";
      applySession(payload.user);
      return null;
    } catch {
      return "تعذر الاتصال بالخادم";
    }
  }

  function applySession(user: { id: number; fullName: string; role: string; specialty: string; username: string; mustChangePassword: boolean }) {
    setSessionUser(user);
    setActiveAccountId(accountForUser(user).id);
    const target = window.location.pathname === "/" ? "overview" : viewForPath(window.location.pathname);
    setView(target);
    setSignedIn(true);
    window.history.replaceState(null, "", VIEW_PATHS[target]);
    window.scrollTo(0, 0);
  }

  /** Email is used for one thing only: proving an address to reset a password. */
  async function sendEmailLink(email: string): Promise<string | null> {
    try {
      const response = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json();
      return response.ok ? null : (payload.error || "تعذر إرسال الرابط");
    } catch {
      return "تعذر الاتصال بالخادم";
    }
  }

  async function signOut() {
    setSignedIn(false);
    setSessionUser(null);
    window.history.pushState(null, "", "/");
    try {
      await fetch("/api/auth/login", { method: "DELETE" });
    } catch { /* the cookie is already dropped locally */ }
  }

  function activateSearchResult(result: GlobalSearchResult) {
    if (result.kind === "account") changeAccount(result.target);
    if (result.kind === "patient") {
      setSearch(result.target);
      navigateTo("payments");
    }
    if (result.kind === "view") navigateTo(result.target as View);
    setGlobalSearch("");
    setSearchOpen(false);
  }

  function showView(nextView: View) {
    if (nextView === "reports") setReportLoading(true);
    if (nextView === "accessRequests") setAccessLoading(true);
    if (nextView === "attendance") setAttendanceLoading(true);
    setView(nextView);
  }

  function navigateTo(nextView: View) {
    showView(nextView);
    setSidebarExpanded(false);
    // pushState rather than a router push: the app stays mounted, so the
    // session survives navigation while the address bar still updates.
    if (typeof window !== "undefined" && window.location.pathname !== VIEW_PATHS[nextView]) {
      window.history.pushState(null, "", VIEW_PATHS[nextView]);
    }
  }

  function notify(message: string, kind: "success" | "info" = "success") {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 3000);
  }

  function toggleTheme() {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("albayati-theme", nextTheme);
  }

  async function installApp(platform: "ios" | "android") {
    if (isInstalled) {
      notify("تطبيق البياتي مثبت بالفعل على هذا الجهاز", "info");
      return;
    }
    if (platform === "android" && installPrompt) {
      try {
        await installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        if (choice.outcome === "accepted") {
          setIsInstalled(true);
          setInstallPrompt(null);
          notify("تمت إضافة البياتي إلى جهازك بنجاح");
        }
      } catch {
        setInstallGuide("android");
      }
      return;
    }
    setInstallGuide(platform);
  }

  async function enableNotifications() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setNotificationPermission("unsupported");
      notify("هذا المتصفح لا يدعم إشعارات التطبيقات", "info");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission !== "granted") {
        notify("يمكن تفعيل الإشعارات لاحقًا من إعدادات المتصفح", "info");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification("إشعارات البياتي مفعّلة", {
        body: `ستصلك تنبيهات المناوبات والحسابات الخاصة بـ ${currentRole.name}.`,
        icon: "/icons/icon-192.png",
        badge: "/icons/favicon-32.png",
        tag: "albayati-notifications-ready",
      });
      notify("تم تفعيل إشعارات البياتي لهذا الجهاز");
    } catch {
      notify("تعذر تفعيل الإشعارات الآن؛ تحقق من سماح المتصفح ثم حاول مجددًا", "info");
    }
  }

  async function downloadAdminReport() {
    try {
      const report = await fetch(ADMIN_REPORT_URL, { method: "HEAD", cache: "no-store" });
      if (!report.ok) throw new Error("report-not-found");
      const link = document.createElement("a");
      link.href = ADMIN_REPORT_URL;
      link.download = "تقرير الإدارة العليا - آب 2026.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setNotificationsOpen(true);
      notify("بدأ تنزيل تقرير الإدارة بصيغة Excel ويمكن تنزيله أيضًا من مركز الإشعارات");
      if (notificationPermission === "granted" && "serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification("تقرير الإدارة جاهز", {
          body: "تقرير آب 2026 متاح الآن بصيغة Excel ويتضمن 4 صفحات تفصيلية.",
          icon: "/icons/icon-192.png",
          badge: "/icons/favicon-32.png",
          tag: "albayati-admin-report-august-2026",
          data: { url: ADMIN_REPORT_URL },
        });
      }
    } catch {
      notify("تعذر تنزيل تقرير الإدارة الآن؛ حاول مرة أخرى", "info");
    }
  }

  async function startAccessRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const provider = (submitter?.value || "email") as "email" | "google" | "apple";
    const values = new FormData(form);
    const draft: AccessDraft = {
      fullName: String(values.get("fullName") || "").trim(),
      requestedRole: String(values.get("requestedRole") || "").trim(),
      specialty: String(values.get("specialty") || "").trim(),
    };
    const email = String(values.get("email") || "").trim();
    setAccessSaving(true);
    try {
      window.localStorage.setItem("albayati-access-draft", JSON.stringify(draft));
      const supabase = await getSupabaseBrowser();
      const redirectTo = `${window.location.origin}/`;
      if (provider === "email") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: redirectTo, data: { full_name: draft.fullName } },
        });
        if (error) throw error;
        setAccessOpen(false);
        notify("أرسلنا رابط التحقق إلى بريدك؛ افتحه لإكمال الطلب", "success");
      } else {
        const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
        if (error) throw error;
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر بدء تسجيل الحساب", "info");
    } finally {
      setAccessSaving(false);
    }
  }

  async function reviewAccessRequest(id: number, decision: "مقبول" | "مرفوض") {
    try {
      const response = await fetch("/api/access-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision, reviewerName: currentRole.name }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر حفظ القرار");
      setAccessRequests((rows) => rows.map((row) => row.id === id ? { ...row, ...data.request } : row));
      notify(decision === "مقبول" ? "تمت الموافقة وإنشاء ملف الموظف" : "تم رفض الطلب");
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر حفظ القرار", "info");
    }
  }

  async function refreshOperations() {
    setAttendanceLoading(true);
    try {
      const [attendanceResponse, telegramResponse] = await Promise.all([
        fetch(`/api/attendance?actorName=${encodeURIComponent(currentRole.name)}`, { cache: "no-store" }),
        fetch(`/api/telegram/status?actorName=${encodeURIComponent(currentRole.name)}`, { cache: "no-store" }),
      ]);
      const [attendance, bot] = await Promise.all([attendanceResponse.json(), telegramResponse.json()]);
      if (!attendanceResponse.ok) throw new Error(attendance.error || "تعذر تحميل سجل الحضور");
      if (!telegramResponse.ok) throw new Error(bot.error || "تعذر تحميل حالة البوت");
      setAttendanceData(attendance);
      setTelegramStatus(bot);
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر تحديث مركز العمليات", "info");
    } finally {
      setAttendanceLoading(false);
    }
  }

  async function toggleEmployeeAttendance(employee: PresenceRecord) {
    setAttendanceSaving(employee.employeeId);
    try {
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: employee.isPresent ? "clock_out" : "clock_in",
          employeeName: employee.fullName,
          actorName: currentRole.name,
          source: "admin",
          note: `سُجّل من لوحة الإدارة بواسطة ${currentRole.name}`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر تحديث الحضور");
      setAttendanceData(data);
      notify(employee.isPresent ? `تم تسجيل انصراف ${employee.fullName}` : `تم تسجيل حضور ${employee.fullName}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر تحديث الحضور", "info");
    } finally {
      setAttendanceSaving(null);
    }
  }

  async function createTelegramLink(employee: PresenceRecord) {
    try {
      const response = await fetch("/api/telegram/link-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: employee.employeeId, actorName: currentRole.name }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر إنشاء رمز الربط");
      setTelegramLink(data);
      notify(`تم إنشاء رمز مؤقت لربط ${employee.fullName}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر إنشاء رمز الربط", "info");
    }
  }

  async function copyTelegramLink() {
    if (!telegramLink) return;
    try {
      await navigator.clipboard.writeText(`${telegramLink.deepLink}\nرمز الربط: ${telegramLink.code}`);
      notify("تم نسخ رابط Telegram ورمز الربط");
    } catch {
      notify("تعذر النسخ التلقائي؛ يمكنك فتح الرابط مباشرة", "info");
    }
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

  async function submitRegistry(event: FormEvent<HTMLFormElement>, kind: "patient" | "employee") {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    setRegistrySaving(true);
    try {
      const response = await fetch("/api/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, actorName: currentRole.name, ...payload }),
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

  async function submitReadmission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    if (!readmissionNewbornId) return notify("اختر المولود العائد أولًا", "info");
    setReadmissionSaving(true);
    try {
      const response = await fetch("/api/registry", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "readmit_newborn",
          patientId: readmissionNewbornId,
          actorName: currentRole.name,
          department: payload.department,
          notes: payload.notes,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر تسجيل عودة المولود");
      setReadmissionCandidates((rows) => rows.filter((row) => row.newbornId !== readmissionNewbornId));
      setReadmissionNewbornId(0);
      setReadmissionMotherId(0);
      form.reset();
      notify(data.message);
    } catch (error) {
      notify(error instanceof Error ? error.message : "تعذر تسجيل عودة المولود", "info");
    } finally {
      setReadmissionSaving(false);
    }
  }

  async function updatePatientLifecycle(patientId: number, action: "convert_to_inpatient" | "discharge") {
    try {
      const response = await fetch("/api/registry", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, action, actorName: currentRole.name }),
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
          actorName: currentRole.name,
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
        body: JSON.stringify({ action: "accept", handoverId: handover.id, actorName: currentRole.name }),
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
            <h1>صباح الخير، د. {doctorProfile.firstName}</h1>
            <p className="muted">هذا ملخص عملك وحساباتك حتى الآن.</p>
          </div>
          <button className="primary-action" onClick={() => navigateTo("workLogs")}><b>＋</b> تسجيل يوم عمل</button>
        </section>

        <section className="doctor-grid">
          <article className="earnings-card">
            <div className="earnings-head">
              <div>
                <span>راتب آب الحالي</span>
                <strong>{money(doctorProfile.currentSalary)}</strong>
              </div>
              <span className="growth">↑ {doctorProfile.growth}%</span>
            </div>
            <Sparkline bars={doctorProfile.bars} />
            <div className="earnings-foot">
              <span>مقارنة بالشهر الماضي</span>
              <b>{money(doctorProfile.previousSalary)}</b>
            </div>
          </article>

          <div className="metric-stack">
            <article className="metric-card teal">
              <div className="metric-icon">⌁</div>
              <div><span>الاستشاريات</span><strong>{money(doctorProfile.consultationAmount)}</strong><small>{IQD.format(doctorProfile.consultationCount)} استشارية معتمدة</small></div>
            </article>
            <article className="metric-card sand">
              <div className="metric-icon">✦</div>
              <div><span>العمليات والرقود</span><strong>{money(doctorProfile.procedureAmount)}</strong><small>{IQD.format(doctorProfile.operationCount)} عملية · {IQD.format(doctorProfile.inpatientCount)} حالة رقود</small></div>
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
              {doctorProfile.days.map((item) => (
                <button className="day-row" key={item.id} onClick={() => navigateTo("workLogs")}>
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
              <p>{doctorProfile.insight}</p>
              <strong>{doctorProfile.highlight}</strong>
            </div>
            <div className="smart-tip">
              <span>!</span>
              <p><b>{doctorProfile.alertTitle}</b> {doctorProfile.alertBody}</p>
            </div>
            <button className="assistant-link" onClick={() => navigateTo("workLogs")}>مراجعة اليوم الآن <span>←</span></button>
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
        <section className="page-title"><div><p className="eyebrow">حساب رئيس المقيمين كطبيب</p><h1>راتبي الشخصي</h1><p>تفاصيل أجرك منفصلة تمامًا عن صلاحيات التدقيق والاعتماد.</p></div><StatusPill tone="pending">تدشيك الراتب</StatusPill></section>
        <section className="doctor-grid">
          <article className="earnings-card"><div className="earnings-head"><div><span>راتب آب الحالي</span><strong>{money(3215000)}</strong></div><span className="growth">↑ 9.8%</span></div><Sparkline /><div className="earnings-foot"><span>من 1 إلى 11 آب</span><b>7 أيام عمل معتمدة</b></div></article>
          <div className="metric-stack"><article className="metric-card teal"><div className="metric-icon">⌁</div><div><span>الاستشاريات</span><strong>{money(1150000)}</strong><small>115 استشارية معتمدة</small></div></article><article className="metric-card sand"><div className="metric-icon">✦</div><div><span>القيصريات والرقود</span><strong>{money(2065000)}</strong><small>بعد تطبيق السقف اليومي</small></div></article></div>
        </section>
        <section className="panel recent-panel"><div className="panel-head"><div><h2>أيام عملي الأخيرة</h2><p>يمكنك فتح أي كول والاطلاع على احتسابه بالتفصيل</p></div><span className="ai-tag">لا تؤثر صلاحيات التدقيق على هذا الحساب</span></div><div className="day-list">{recentDays.slice(0, 3).map((item) => <button className="day-row" key={item.id} onClick={() => navigateTo("workLogs")}><span className="date-tile"><b>{item.date.split(" ")[0]}</b><small>آب</small></span><span className="day-copy"><b>{item.day}</b><small>{item.details}</small></span><StatusPill tone={item.tone}>{item.status}</StatusPill><strong className="row-amount">{money(item.amount)}</strong><span className="chevron">‹</span></button>)}</div></section>
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
    const chart = Array(8).fill(4);
    return (
      <>
        <section className="welcome-row"><div><p className="eyebrow">الإدارة العليا · رئاسة القسم</p><h1>مرحبًا، مصطفى البياتي</h1><p className="muted">بدأت النسخة التجريبية ببيانات تشغيلية صفرية وجاهزة للإدخال الحقيقي.</p></div><button className="secondary-action report-download-button" onClick={downloadAdminReport}><span>XL</span> تنزيل تقرير Excel</button></section>
        <section className="stat-row executive">
          <article><span className="stat-symbol green">↗</span><div><small>إجمالي العوائد</small><strong>{money(0)}</strong><em>بانتظار أول حركة مالية</em></div></article>
          <article><span className="stat-symbol blue">♙</span><div><small>المرضى هذا الشهر</small><strong>0</strong><em>لا توجد حالات مسجلة</em></div></article>
          <article><span className="stat-symbol amber">✦</span><div><small>مستحقات الأطباء</small><strong>{money(0)}</strong><em>3 حسابات أطباء جاهزة</em></div></article>
          <article><span className="stat-symbol red">⌛</span><div><small>ذمم قيد التحصيل</small><strong>{money(0)}</strong><em>لا توجد دفعات معلقة</em></div></article>
        </section>
        <section className="content-grid admin-grid">
          <article className="panel chart-panel"><div className="panel-head"><div><h2>اتجاه العوائد</h2><p>يبدأ الرسم من أول حركة مالية حقيقية</p></div><StatusPill tone="approved">بيانات صفرية</StatusPill></div>
            <div className="bar-chart">{chart.map((height, i) => <div key={i}><span style={{ height: `${height}%` }}><i>0</i></span><small>{["ك2", "ش", "آذ", "ن", "أي", "ح", "ت", "آب"][i]}</small></div>)}</div>
          </article>
          <aside className="panel mix-panel"><div className="panel-head"><div><h2>توزيع الإجراءات</h2><p>لا توجد إجراءات بعد</p></div></div><div className="donut empty" aria-label="لا توجد إجراءات"><div><strong>0</strong><small>إجراء</small></div></div><ul className="legend"><li><i className="teal-dot" />استشاريات <b>0%</b></li><li><i className="orange-dot" />عمليات <b>0%</b></li><li><i className="sand-dot" />رقود <b>0%</b></li></ul></aside>
        </section>
        <section className="panel admin-alerts"><div className="panel-head"><div><h2>مؤشرات تحتاج متابعة</h2><p>ستظهر التنبيهات بعد بدء العمل الفعلي</p></div><span className="ai-tag">✦ جاهز للتحليل</span></div><div className="report-empty"><span>✓</span><p><b>لا توجد مؤشرات معلقة</b><small>المرضى والرواتب والمصروفات والدفعات تبدأ جميعها من الصفر.</small></p></div></section>
      </>
    );
  }

  function renderAudit() {
    const visible = auditRows.filter((row) => auditFilter === "الكل" || (auditFilter === "تجاوزات" ? row.over : !row.over));
    return (
      <>
        <section className="page-title"><div><p className="eyebrow">رئيس المقيمين</p><h1>التدقيق والاعتماد</h1><p>راجع إدخالات الأطباء واتخذ القرار النهائي.</p></div><div className="title-stat"><small>بانتظارك</small><strong>{auditRows.length}</strong></div></section>
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
    const activeTab = role === "accounts" || role === "doctor" || role === "admin" ? "patient" : registryTab;
    const latest = activeTab === "patient" ? registeredPatients : registeredEmployees;
    const isDoctorRole = employeeRole === "طبيب مقيم" || employeeRole === "رئيس المقيمين";
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
            {role === "chief" && <button className={activeTab === "employee" ? "active" : ""} onClick={() => setRegistryTab("employee")}>
              <span>✦</span><div><b>تسجيل موظف</b><small>الدور والاختصاص والصلاحيات</small></div><i>←</i>
            </button>}
            <div className="registry-tip"><span className="ai-orb">✦</span><p><b>مساعد التسجيل</b><small>{activeTab === "patient" ? "يتحقق من رقم الملف والحقول الأساسية قبل إنشاء سجل المريض." : "يضبط سقوف الأطباء تلقائيًا حسب الدور المختار."}</small></p></div>
          </aside>

          <div className="registry-main">
            {activeTab === "patient" ? (
              <>
              <form className="registry-form" onSubmit={(event) => submitRegistry(event, "patient")}>
                <div className="registry-form-head"><div><span>♙</span><p><b>بيانات المريض</b><small>الحقول المعلّمة مطلوبة لإنشاء الملف</small></p></div><StatusPill tone="approved">نموذج جديد</StatusPill></div>
                <div className="form-section-title"><span>1</span><div><b>المعلومات الأساسية</b><small>الهوية ووسائل التواصل</small></div></div>
                <div className="registry-fields">
                  <label className="form-field wide"><span>الاسم الثلاثي للمريضة <b>*</b></span><input name="fullName" required value={patientName} onChange={(event) => setPatientName(event.target.value)} placeholder="مثال: زهراء علي خلف" /></label>
                  <label className="form-field"><span>رقم الملف <b>*</b></span><input name="fileNumber" required defaultValue={`P-${1050 + registeredPatients.length}`} dir="ltr" /></label>
                  <label className="form-field"><span>تاريخ الميلاد</span><input name="birthDate" type="date" /></label>
                  {isBirthCase
                    ? <div className="form-field implied-field"><span>الجنس</span><p><b>أنثى</b><small>حالة ولادة — الملف للأم، فلا حاجة للسؤال</small></p></div>
                    : <label className="form-field"><span>الجنس <b>*</b></span><select name="gender" required defaultValue="أنثى"><option>أنثى</option><option>ذكر</option></select></label>}
                  <label className="form-field"><span>رقم الهاتف</span><input name="phone" type="tel" placeholder="07XX XXX XXXX" dir="ltr" /></label>
                </div>
                <div className="form-section-title"><span>2</span><div><b>بيانات الدخول</b><small>القسم والطبيب وتصنيف الدفع</small></div></div>
                <div className="registry-fields">
                  <label className="form-field"><span>تاريخ الدخول <b>*</b></span><input name="admissionDate" type="date" required defaultValue="2026-08-11" /></label>
                  <label className="form-field"><span>نوع الدخول <b>*</b></span><select name="entryType" required value={patientEntryType} onChange={(event) => { setPatientEntryType(event.target.value); setPatientInitialPrice(getInitialPrice(event.target.value)); if (!isBirthEntry(event.target.value)) setNewbornCount(0); }}><option>استشارية</option><option>رقود</option><option>ولادة طبيعية</option><option>عملية قيصرية</option></select></label>
                  <label className="form-field"><span>{patientEntryType === "رقود" ? "تسعيرة يوم الرقود" : "التسعيرة الأولية"} (د.ع)</span><input name="initialPrice" type="number" min="0" step="1000" value={patientInitialPrice} onChange={(event) => setPatientInitialPrice(Number(event.target.value))} /></label>
                  <label className="form-field"><span>القسم الطبي <b>*</b></span><select name="department" required defaultValue=""><option value="" disabled>اختر القسم</option><option>النسائية والتوليد</option><option>الجراحة العامة</option><option>الطب الباطني</option><option>طب الأطفال</option><option>الطوارئ</option><option>العناية المركزة</option></select></label>
                  <label className="form-field"><span>الطبيب المسؤول</span><select name="attendingDoctor" defaultValue=""><option value="">يُحدد لاحقًا</option><option>د. شهد</option><option>د. تبارك</option><option>د. فنار</option></select></label>
                  <label className="form-field"><span>تصنيف الدفع <b>*</b></span><select name="paymentCategory" required defaultValue="نقدي"><option>نقدي</option><option>مجاني</option><option>تأمين</option><option>آجل</option></select></label>
                  {isBirthCase && <label className="form-field"><span>عدد المواليد</span><div className="newborn-count-field"><select value={newbornCount <= 4 ? newbornCount : "custom"} onChange={(event) => setNewbornCount(event.target.value === "custom" ? 5 : Number(event.target.value))}><option value="0">يُسجل لاحقًا</option><option value="1">مولود واحد</option><option value="2">توأم</option><option value="3">ثلاثة توائم</option><option value="4">أربعة توائم</option><option value="custom">عدد آخر (حالة نادرة)</option></select>{newbornCount > 4 && <input type="number" min="5" max={MAX_NEWBORNS} value={newbornCount} onChange={(event) => setNewbornCount(Math.min(MAX_NEWBORNS, Math.max(5, Number(event.target.value) || 5)))} aria-label="عدد المواليد" />}</div><input type="hidden" name="newbornCount" value={newbornCount} /></label>}
                  <label className="form-field full"><span>ملاحظات أولية</span><textarea name="notes" rows={3} placeholder="الحالة عند الدخول أو أي معلومات مهمة للكادر..." /></label>
                </div>
                {isBirthCase && <div className="pricing-rule-note"><span>↻</span><p><b>قاعدة منع الازدواجية مفعّلة</b><small>إذا تحولت الحالة إلى رقود، يُبطل النظام تسعيرة الولادة ويحفظ سبب الإلغاء، ثم يبدأ التسعير التراكمي للرقود.</small></p></div>}
                {newbornNames.length > 0 && <div className="newborn-preview"><div><span>♙</span><p><b>السجلات التي سيُنشئها النظام</b><small>مرتبطة تلقائيًا بملف الأم ومنفصلة طبيًا وماليًا</small></p></div><ul>{newbornNames.map((name, index) => <li key={name}><i>{index + 1}</i>{name}<StatusPill tone="approved">مولود جديد</StatusPill></li>)}</ul></div>}
                <div className="registry-submit"><p><span>✓</span><small>سيظهر المريض مباشرة في البحث وحالات الدفع بعد التسجيل.</small></p><button className="primary-action" disabled={registrySaving}>{registrySaving ? "جارٍ الحفظ..." : "حفظ ملف المريض"}<span>←</span></button></div>
              </form>
              <form className="registry-form readmission-form" onSubmit={submitReadmission}>
                <div className="registry-form-head"><div><span>♙</span><p><b>عودة مولود بعد الخروج</b><small>يُفتح ملفه الأصلي المرتبط بأمه — بلا تسجيل مكرر</small></p></div><StatusPill tone={readmissionCandidates.length ? "pending" : "approved"}>{readmissionCandidates.length ? `${readmissionCandidates.length} مولود خارج المستشفى` : "لا مواليد خارج المستشفى"}</StatusPill></div>
                {readmissionCandidates.length === 0 ? (
                  <p className="empty-hint">لا يوجد حاليًا مولود مسجّل خروجه. يظهر هنا تلقائيًا كل مولود غادر المستشفى، ليعاد فتح ملفه عند عودته.</p>
                ) : (
                  <>
                    <div className="registry-fields">
                      <label className="form-field"><span>ملف الأم <b>*</b></span><select required value={readmissionMotherId} onChange={(event) => { setReadmissionMotherId(Number(event.target.value)); setReadmissionNewbornId(0); }}><option value={0} disabled>اختر الأم</option>{readmissionMothers.map((row) => <option key={row.motherId} value={row.motherId}>{row.motherName} · {row.motherFileNumber}</option>)}</select></label>
                      <label className="form-field"><span>المولود العائد <b>*</b></span><select required value={readmissionNewbornId} disabled={!readmissionMotherId} onChange={(event) => setReadmissionNewbornId(Number(event.target.value))}><option value={0} disabled>{readmissionMotherId ? "اختر المولود" : "اختر الأم أولًا"}</option>{readmissionNewborns.map((row) => <option key={row.newbornId} value={row.newbornId}>{row.newbornName}{row.twinOrder ? ` (${row.twinOrder})` : ""} · {row.newbornFileNumber}</option>)}</select></label>
                      <label className="form-field"><span>القسم المستقبِل <b>*</b></span><select name="department" required defaultValue="حديثو الولادة"><option>حديثو الولادة</option><option>طب الأطفال</option><option>العناية المركزة</option><option>الطوارئ</option></select></label>
                      <label className="form-field full"><span>سبب العودة</span><textarea name="notes" rows={2} placeholder="يرقان، صعوبة رضاعة، حرارة..." /></label>
                    </div>
                    <div className="registry-submit"><p><span>↻</span><small>لن يُنشأ ملف جديد — يُعاد فتح السجل نفسه وتُسجَّل العودة في تاريخه المالي والطبي.</small></p><button className="primary-action" disabled={readmissionSaving || !readmissionNewbornId}>{readmissionSaving ? "جارٍ التسجيل..." : "تسجيل عودة المولود"}<span>←</span></button></div>
                  </>
                )}
              </form>
              </>
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
                  <label className="form-field"><span>الدور الوظيفي <b>*</b></span><select name="role" required value={employeeRole} onChange={(event) => setEmployeeRole(event.target.value)}><option>طبيب مقيم</option><option>رئيس المقيمين</option><option>موظف استقبال</option><option>الحسابات</option><option>الإدارة العليا</option></select></label>
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
    const doctorOptions = ["د. شهد", "د. تبارك", "د. فنار"];
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

  function renderAttendance() {
    const formatOperationsTime = (value?: string | null) => value
      ? new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { timeZone: "Asia/Baghdad", dateStyle: "short", timeStyle: "short" }).format(new Date(value))
      : "لا يوجد";
    const sourceLabel: Record<string, string> = { web: "الموقع", telegram: "بوت البياتي", admin: "الإدارة", system: "النظام" };
    const query = attendanceFilter.trim().toLocaleLowerCase("ar");
    const visiblePresence = (attendanceData?.presence || []).filter((employee) =>
      !query || `${employee.fullName} ${employee.role} ${employee.specialty}`.toLocaleLowerCase("ar").includes(query),
    );
    const configuration = telegramStatus?.configuration;
    const authorizedBotAdmins = telegramStatus?.bootstrapAdmins.length ? telegramStatus.bootstrapAdmins : [
      { employeeName: "مصطفى البياتي", username: "dr_mustafa_albayati", phoneNumber: "+9647705693132", status: "بانتظار تطبيق قاعدة البيانات" },
      { employeeName: "مدير بوت معتمد", username: null, phoneNumber: "+9647884669922", status: "بانتظار تطبيق قاعدة البيانات" },
    ];
    return <>
      <section className="page-title operations-heading">
        <div><p className="eyebrow">الإدارة العليا · بيانات تشغيلية مباشرة</p><h1>الحضور والنشاط وبوت البياتي</h1><p>تعرف من يوجد في المستشفى الآن، ووقت حضوره، وآخر عملية نفذها، سواء من الموقع أو Telegram.</p></div>
        <button className="secondary-action" type="button" onClick={refreshOperations} disabled={attendanceLoading}>↻ تحديث الآن</button>
      </section>

      <section className={`panel telegram-control ${configuration?.webhookReady ? "ready" : "waiting"}`}>
        <div className="telegram-control-icon">✈</div>
        <div className="telegram-control-copy">
          <p className="eyebrow">@{telegramStatus?.botUsername || "Albayati_sysbot"}</p>
          <h2>بوت البياتي التشغيلي</h2>
          <p>{configuration?.webhookReady ? "إعدادات التشغيل المستمر مكتملة، وجميع الأوامر تذهب إلى قاعدة النظام نفسها." : "تم تجهيز الأوامر وقاعدة البيانات والربط الآمن محليًا. ينتظر مفتاحًا جديدًا وموافقتك على النشر قبل تشغيل Webhook على مدار الساعة."}</p>
        </div>
        <div className="telegram-readiness">
          <span className={configuration?.tokenConfigured ? "done" : ""}>✓ مفتاح جديد</span>
          <span className={configuration?.secretConfigured ? "done" : ""}>✓ توقيع Webhook</span>
          <span className={configuration?.publicUrlConfigured ? "done" : ""}>✓ عنوان HTTPS</span>
          <b>{configuration?.webhookReady ? "جاهز للتشغيل" : "جاهز برمجيًا · غير منشور"}</b>
        </div>
      </section>

      <section className="bot-admin-grid">
        <article className="panel bot-admin-card"><div className="panel-head"><div><h2>مديرو البوت المعتمدون</h2><p>الدخول لا يكتمل إلا بعد مشاركة الرقم من حساب Telegram نفسه</p></div><span className="request-count">{IQD.format(authorizedBotAdmins.length)}</span></div>{authorizedBotAdmins.map((admin) => <div className="bot-admin-person" key={admin.phoneNumber}><span className="record-avatar employee">{admin.employeeName[0]}</span><p><b>{admin.employeeName}</b><small>{admin.username ? `@${admin.username} · ` : ""}<span dir="ltr">{admin.phoneNumber}</span></small></p><em>{admin.status === "تم التحقق" ? "مدير بوت فعّال" : "يرسل Start ثم يشارك رقمه"}</em></div>)}</article>
        <article className="panel bot-admin-card"><div className="panel-head"><div><h2>سياسة الوصول إلى البوت</h2><p>لا توجد موافقات تلقائية ولا طلبات عامة</p></div><StatusPill tone="approved">مقيد</StatusPill></div><div className="bot-admin-empty"><span>✓</span><p><b>المستخدم غير المسجل يُرفض مباشرة</b><small>تظهر له رسالة «لا تمتلك الصلاحيات»، ولا تُنشأ له هوية أو صلاحية داخل النظام.</small></p></div></article>
      </section>

      {telegramLink && <section className="panel telegram-link-card">
        <div><p className="eyebrow">رمز لمرة واحدة · صالح 15 دقيقة</p><h2>ربط Telegram مع {telegramLink.employeeName}</h2><p>يفتح الموظف الرابط ثم يضغط «بدء». لا يمكن استعمال الرمز بعد نجاح الربط.</p></div>
        <code dir="ltr">{telegramLink.code}</code>
        <div><a href={telegramLink.deepLink} target="_blank" rel="noreferrer">فتح بوت البياتي</a><button type="button" onClick={copyTelegramLink}>نسخ الرابط</button><button type="button" onClick={() => setTelegramLink(null)}>إغلاق</button></div>
      </section>}

      <section className="operations-kpis">
        <article><span>●</span><div><small>الموجودون الآن</small><strong>{IQD.format(attendanceData?.summary.present || 0)}</strong><em>من أصل {IQD.format(attendanceData?.summary.total || 0)} موظفًا نشطًا</em></div></article>
        <article><span>↪</span><div><small>حضور اليوم</small><strong>{IQD.format(attendanceData?.summary.arrivalsToday || 0)}</strong><em>جلسات موثقة بالتوقيت</em></div></article>
        <article><span>≈</span><div><small>نشاط آخر 15 دقيقة</small><strong>{IQD.format(attendanceData?.summary.activeLast15Minutes || 0)}</strong><em>من الموقع أو Telegram</em></div></article>
        <article><span>✓</span><div><small>مهام مفتوحة</small><strong>{IQD.format(attendanceData?.summary.openTasks || 0)}</strong><em>قابلة للمتابعة عبر البوت</em></div></article>
        <article><span>✈</span><div><small>حسابات Telegram</small><strong>{IQD.format(telegramStatus?.linkedAccounts.length || 0)}</strong><em>مرتبطة بهوية موظفين</em></div></article>
      </section>

      <section className="panel presence-panel">
        <div className="panel-head operations-toolbar"><div><h2>حالة جميع الموظفين</h2><p>آخر نشاط هو آخر عملية موثقة، وليس مجرد فتح الصفحة.</p></div><label className="table-search"><span>⌕</span><input value={attendanceFilter} onChange={(event) => setAttendanceFilter(event.target.value)} placeholder="ابحث بالاسم أو الدور أو الاختصاص" /></label></div>
        {attendanceLoading ? <div className="registry-empty"><span className="loading-ring" /><p>جارٍ تحميل الحضور والنشاط...</p></div> : <div className="presence-table">
          <div className="presence-head"><span>الموظف</span><span>الحالة والحضور</span><span>آخر نشاط</span><span>المصدر والربط</span><span>إجراء الإدارة</span></div>
          {visiblePresence.map((employee) => <div className="presence-row" key={employee.employeeId}>
            <span className="presence-employee"><i className="record-avatar employee">{employee.fullName[0]}</i><span><b>{employee.fullName}</b><small>{employee.role} · {employee.specialty}</small></span></span>
            <span className="presence-state"><StatusPill tone={employee.isPresent ? "approved" : "pending"}>{employee.isPresent ? "موجود الآن" : "غير موجود"}</StatusPill><small>{employee.isPresent ? `منذ ${formatOperationsTime(employee.clockInAt)}` : "لا توجد جلسة مفتوحة"}</small></span>
            <span className="presence-activity"><b>{employee.lastActivity || "لا يوجد نشاط مسجل"}</b><small>{formatOperationsTime(employee.lastActivityAt)}</small></span>
            <span className="presence-source"><b>{sourceLabel[employee.lastActivitySource || ""] || "—"}</b><small>{employee.telegramStatus === "معتمد" ? `Telegram مرتبط${employee.telegramUsername ? ` · @${employee.telegramUsername}` : ""}` : "Telegram غير مرتبط"}</small></span>
            <span className="presence-actions"><button type="button" className={employee.isPresent ? "clock-out" : "clock-in"} disabled={attendanceSaving === employee.employeeId} onClick={() => toggleEmployeeAttendance(employee)}>{attendanceSaving === employee.employeeId ? "جارٍ الحفظ" : employee.isPresent ? "تسجيل انصراف" : "تسجيل حضور"}</button><button type="button" className="link-telegram" onClick={() => createTelegramLink(employee)}>ربط Telegram</button></span>
          </div>)}
          {!visiblePresence.length && <div className="report-empty"><span>⌕</span><p><b>لا توجد نتيجة مطابقة</b><small>جرّب الاسم أو الدور الوظيفي.</small></p></div>}
        </div>}
      </section>

      <section className="operations-detail-grid">
        <article className="panel attendance-history"><div className="panel-head"><div><h2>آخر سجلات الدخول والخروج</h2><p>سجل كامل لا يُستبدل عند إنشاء جلسة جديدة</p></div></div><div>{(attendanceData?.sessions || []).slice(0, 10).map((session) => <div key={session.id}><span>{session.clockOutAt ? "↪" : "●"}</span><p><b>{session.employeeName}</b><small>دخول: {formatOperationsTime(session.clockInAt)} · خروج: {formatOperationsTime(session.clockOutAt)}</small></p><em>{sourceLabel[session.clockOutSource || session.clockInSource] || "النظام"}</em></div>)}{!attendanceData?.sessions.length && <div className="report-empty"><p><b>لا توجد جلسات بعد</b><small>سيظهر أول سجل فور تسجيل حضور موظف.</small></p></div>}</div></article>
        <article className="panel operations-tasks"><div className="panel-head"><div><h2>المهام المفتوحة</h2><p>يمكن بدء المتابعة أو الإكمال من بوت البياتي</p></div><StatusPill tone="pending">{IQD.format(attendanceData?.tasks.length || 0)} مهمة</StatusPill></div><div>{(attendanceData?.tasks || []).slice(0, 10).map((task) => <div key={task.id}><span>#{IQD.format(task.id)}</span><p><b>{task.title}</b><small>{task.assigneeName} · {task.status}{task.dueAt ? ` · ${formatOperationsTime(task.dueAt)}` : ""}</small></p><StatusPill tone={task.priority === "عاجلة" ? "returned" : task.priority === "مهمة" ? "pending" : "approved"}>{task.priority}</StatusPill></div>)}{!attendanceData?.tasks.length && <div className="report-empty"><span>✓</span><p><b>لا توجد مهام مفتوحة</b><small>أنشئ مهمة من البوت بالأمر /task.</small></p></div>}</div></article>
      </section>

      <section className="demo-notice bot-security-note"><span>!</span><p><b>إجراء أمني مطلوب قبل التشغيل</b><small>مفتاح Telegram الذي أُرسل في المحادثة أصبح مكشوفًا؛ لن يستخدمه النظام. يجب إلغاؤه من BotFather وإنشاء مفتاح جديد ثم حفظه كمتغير سري فقط.</small></p></section>
    </>;
  }

  function renderSettings() {
    const doctors = [
      ["د. شهد", "0", "0"], ["د. تبارك", "0", "0"], ["د. فنار", "0", "0"],
    ];
    return <><section className="page-title"><div><p className="eyebrow">قواعد العمل</p><h1>{role === "admin" ? "إدارة النظام" : "سقوف الأطباء"}</h1><p>تُطبّق القيم فورًا على الحسابات الجديدة مع حفظ سجل التعديل.</p></div><StatusPill tone="approved">المحرك يعمل</StatusPill></section><section className="panel caps-panel"><div className="panel-head"><div><h2>السقوف الفردية</h2><p>الاستشاريات منفصلة عن سقف العمليات والرقود</p></div><button className="secondary-action" onClick={() => notify("حُفظت جميع إعدادات السقوف")}>حفظ التغييرات</button></div><div className="caps-table"><div className="caps-head"><span>الطبيب</span><span>أقصى استشاريات/يوم</span><span>السقف اليومي</span><span>آخر تحديث</span></div>{doctors.map((doctor, index) => <div className="caps-row" key={doctor[0]}><span className="doctor-cell"><i className="doctor-avatar">{doctor[0][3]}</i><b>{doctor[0]}</b></span><label><input defaultValue={doctor[1]} /><small>استشارية</small></label><label><input defaultValue={doctor[2]} /><small>د.ع</small></label><span className="muted">{index < 2 ? "اليوم" : "4 آب 2026"}</span></div>)}</div></section></>;
  }

  function renderReports() {
    const maxPatients = Math.max(1, ...(reportData?.dailySeries.map((day) => day.patients) || [1]));
    const periodLabel = reportPeriod === "daily" ? "يومي" : reportPeriod === "weekly" ? "أسبوعي" : "شهري";
    const dateFormat = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { day: "numeric", month: "short" });
    const financialCards = reportData && role !== "doctor" ? [
      ["الإيرادات المسجلة", money(reportData.summary.revenue), "↗"],
      ["المصروفات", money(reportData.summary.expenses), "↘"],
      ["الرواتب المعتمدة", money(reportData.summary.salaries), "◇"],
      ["صافي الفترة", money(reportData.summary.net), "="],
    ] : [];
    return <>
      <section className="page-title report-heading"><div><p className="eyebrow">بيانات مباشرة من قاعدة المستشفى</p><h1>التقارير اليومية والأسبوعية والشهرية</h1><p>اختر التاريخ والفترة لعرض أرقام قابلة للتتبع دون بيانات افتراضية.</p></div><button className="secondary-action" onClick={() => window.print()}>⇩ طباعة التقرير</button></section>
      <section className="panel report-controls" aria-label="مرشحات التقرير">
        <div className="period-switch">{(["daily", "weekly", "monthly"] as const).map((period) => <button key={period} className={reportPeriod === period ? "active" : ""} onClick={() => { setReportLoading(true); setReportPeriod(period); }}>{period === "daily" ? "يومي" : period === "weekly" ? "أسبوعي" : "شهري"}</button>)}</div>
        <label className="report-date"><span>التاريخ المرجعي</span><input type="date" value={reportDate} onChange={(event) => { setReportLoading(true); setReportDate(event.target.value); }} /></label>
        <div className="live-data"><i /><span><b>بيانات مباشرة</b><small>{reportData ? `${reportData.range.start} — ${reportData.range.end}` : "جارٍ الاتصال"}</small></span></div>
      </section>
      {reportLoading ? <section className="panel report-loading"><span className="loading-ring" /><p>جارٍ إنشاء التقرير {periodLabel}...</p></section> : reportData ? <>
        <section className="report-kpis">
          {[
            ["المرضى المسجلون", IQD.format(reportData.summary.patients), "♙"],
            ["حالات الولادة", IQD.format(reportData.summary.birthCases), "✦"],
            ["المواليد الجدد", IQD.format(reportData.summary.newborns), "◎"],
            ["المرضى النشطون الآن", IQD.format(reportData.summary.activePatients), "●"],
            ["مرضى تم استلامهم", IQD.format(reportData.summary.receivedPatients), "⇄"],
            ["تسليمات مكتملة", IQD.format(reportData.summary.acceptedHandovers), "✓"],
            ["أيام رقود مدفوعة", IQD.format(reportData.summary.paidInpatientDays), "▣"],
            ["دفعات معلقة", IQD.format(reportData.summary.pendingPayments), "⌛"],
            ...financialCards,
          ].map(([label, value, icon]) => <article key={label}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></article>)}
        </section>
        <section className="report-dashboard-grid">
          <article className="panel report-trend"><div className="panel-head"><div><h2>حركة المرضى خلال الفترة</h2><p>التسجيلات اليومية وحالات الولادة</p></div><StatusPill tone="approved">{periodLabel}</StatusPill></div>
            <div className="report-chart" role="img" aria-label="مخطط عدد المرضى حسب اليوم">{reportData.dailySeries.map((day) => <div key={day.date}><span className="chart-value">{IQD.format(day.patients)}</span><i><b style={{ height: `${Math.max(day.patients ? 12 : 3, (day.patients / maxPatients) * 100)}%` }} /></i><small>{dateFormat.format(new Date(`${day.date}T00:00:00Z`))}</small></div>)}</div>
          </article>
          <aside className="panel top-doctors"><div className="panel-head"><div><h2>الأطباء الأكثر استلامًا</h2><p>بحسب المرضى المسلّمين فعليًا</p></div></div>
            {reportData.topDoctors.length ? <ol>{reportData.topDoctors.map((doctor, index) => <li key={doctor.name}><span>{index + 1}</span><div><b>{doctor.name}</b><small>استلم {IQD.format(doctor.patientsReceived)} مريضًا</small></div><strong>{IQD.format(doctor.patientsReceived)}</strong></li>)}</ol> : <div className="report-empty"><span>⇄</span><p><b>لا توجد تسليمات مكتملة</b><small>ستظهر النتائج عند استلام المناوبات ضمن الفترة المحددة.</small></p></div>}
          </aside>
        </section>
        <section className="panel finance-table"><div className="panel-head"><div><h2>السجل اليومي التفصيلي</h2><p>أساس مراجعة الإيرادات والمصروفات والرواتب</p></div></div><div className="report-table"><div className="report-table-head"><span>التاريخ</span><span>المرضى</span><span>الولادات</span><span>الإيرادات</span><span>المصروفات</span><span>الرواتب</span></div>{reportData.dailySeries.map((day) => <div key={day.date}><b>{day.date}</b><span>{IQD.format(day.patients)}</span><span>{IQD.format(day.births)}</span><span>{money(day.revenue)}</span><span>{money(day.expenses)}</span><span>{money(day.salaries)}</span></div>)}</div></section>
      </> : <section className="panel report-loading"><p>تعذر عرض التقرير لهذه الفترة.</p></section>}
    </>;
  }

  function renderCapabilities() {
    const roleCapabilities: Record<Role, { title: string; description: string; action: string }[]> = {
      doctor: [
        { title: "استلام المناوبة", description: "مشاهدة المرضى والأولوية والإجراء التالي ثم تأكيد انتقال المسؤولية.", action: "handover" },
        { title: "توثيق يوم العمل", description: "إضافة الكول والاستشاريات وصورة كل حالة والولادات والرقود والحالات الخاصة.", action: "workLogs" },
        { title: "الاعتراض المالي", description: "إرسال اعتراض خاص ومتابعة نتيجة التدقيق والتسوية في كشف الحساب.", action: "objections" },
        { title: "متابعة الحساب", description: "عرض البيانات المعتمدة ومصدر كل مبلغ حسب التاريخ.", action: "reports" },
      ],
      chief: [
        { title: "التدقيق والاعتماد", description: "مراجعة الإثباتات والتجاوزات قبل تحويل المبلغ إلى الحسابات.", action: "audit" },
        { title: "إدارة حسابات المستخدمين", description: "مراجعة طلبات الدخول وإنشاء الحسابات وتحديد الصلاحية والاختصاص.", action: "accessRequests" },
        { title: "تسوية الاعتراضات", description: "تدقيق اعتراض الطبيب وإظهار كشف واضح وإضافة الاستحقاق الصحيح.", action: "objections" },
        { title: "إدارة المناوبات", description: "التأكد من اكتمال التسليم وعدم ضياع متابعة أي مريض.", action: "handover" },
        { title: "ضبط السقوف", description: "تحديث سقف كل طبيب مع تطبيق قواعد الحساب الموحدة.", action: "settings" },
      ],
      accounts: [
        { title: "التسجيل الطبي", description: "إنشاء ملفات المرضى وربط المواليد بملف الأم دون تكرار.", action: "registry" },
        { title: "مطابقة المدفوعات", description: "تثبيت حالة كل يوم رقود وإعادة احتساب المستحقات.", action: "payments" },
        { title: "التقارير المالية", description: "مراجعة الإيرادات والمصروفات والرواتب حسب الفترة.", action: "reports" },
      ],
      admin: [
        { title: "الحضور والنشاط", description: "معرفة الموجودين الآن ووقت دخولهم وآخر عملية نفذها كل موظف ومصدرها.", action: "attendance" },
        { title: "لوحة التقارير", description: "متابعة المرضى والولادات والتسليمات والنتائج المالية الفعلية.", action: "reports" },
        { title: "سجلات المناوبات", description: "متابعة السجلات المرسلة والجهات المستلمة والأثر المالي دون تعديلها.", action: "workLogs" },
        { title: "البحث الإداري", description: "الوصول إلى ملفات المرضى وحالتهم الحالية حسب الصلاحية.", action: "registry" },
      ],
      developer: [
        { title: "بوت البياتي", description: "مراقبة جاهزية Webhook والربط الفردي وأخطاء الأوامر دون كشف المفاتيح السرية.", action: "attendance" },
        { title: "سلامة النظام", description: "مراقبة جاهزية قواعد البيانات والخدمات دون تولي القرارات الطبية أو المالية.", action: "settings" },
        { title: "سجل الأثر", description: "مراجعة السجل التقني للتعديلات عند التحقيق في مشكلة مصرح بها.", action: "workLogs" },
        { title: "صحة التقارير", description: "التأكد من اتساق مؤشرات التقارير ومصادرها.", action: "reports" },
      ],
    };
    return <><section className="page-title"><div><p className="eyebrow">دليل تشغيلي حسب الدور</p><h1>مهامي وصلاحياتي</h1><p>كل مستخدم يرى ما يخص عمله بعبارات واضحة وخطوات مباشرة.</p></div><StatusPill tone="approved">{currentRole.label}</StatusPill></section><section className="capability-grid">{roleCapabilities[role].map((item, index) => <article className="panel capability-card" key={item.title}><span>{index + 1}</span><div><h2>{item.title}</h2><p>{item.description}</p></div><button className="text-button" onClick={() => navigateTo(item.action as View)}>فتح المهمة ←</button></article>)}</section><section className="panel safety-workflow"><div><span>✓</span><p><b>ضوابط تحمي دورة العمل</b><small>تأكيد هوية المريض · سجل زمني للتسليم · موافقة قبل تفعيل الحساب · تتبع مصدر المبلغ.</small></p></div><div><span>⇄</span><p><b>لا تضيع المتابعة بين المناوبات</b><small>تبقى مسؤولية المريض للطبيب الأول حتى يؤكد الطبيب الثاني الاستلام.</small></p></div></section></>;
  }

  function renderAccessRequests() {
    const pendingCount = accessRequests.filter((item) => item.status === "بانتظار الموافقة").length;
    const providerLabel = { email: "البريد الإلكتروني", google: "Google", apple: "Apple" };
    return <><section className="page-title"><div><p className="eyebrow">رئيس المقيمين · وضع المعاينة</p><h1>طلبات إنشاء الحسابات</h1><p>لن يدخل أي طبيب أو مستخدم جديد قبل موافقة رئيس المقيمين وتحديد صلاحيته.</p></div><div className="title-stat"><small>بانتظار القرار</small><strong>{IQD.format(pendingCount)}</strong></div></section><section className="demo-notice"><span>i</span><p><b>المراجعة التجريبية مفعّلة مؤقتًا</b><small>الحسابات التجريبية باقية لتجربة الأدوار؛ عند اعتماد التشغيل النهائي تُقفل هذه الشاشة بحساب رئيس المقيمين الحقيقي.</small></p></section><section className="panel access-list"><div className="panel-head"><div><h2>سجل الطلبات</h2><p>البريد والموفر والدور والاختصاص</p></div><button className="secondary-action" onClick={() => setAccessOpen(true)}>＋ طلب تجريبي</button></div>{accessLoading ? <div className="registry-empty"><span className="loading-ring" /><p>جارٍ تحميل الطلبات...</p></div> : accessRequests.length ? accessRequests.map((item) => <div className="access-row" key={item.id}><span className="record-avatar employee">{item.fullName[0]}</span><p><b>{item.fullName}</b><small>{item.email} · {providerLabel[item.provider]} · {item.requestedRole} · {item.specialty}</small></p><StatusPill tone={item.status === "مقبول" ? "approved" : item.status === "مرفوض" ? "returned" : "pending"}>{item.status}</StatusPill>{item.status === "بانتظار الموافقة" && <div className="access-actions"><button onClick={() => reviewAccessRequest(item.id, "مقبول")}>قبول</button><button onClick={() => reviewAccessRequest(item.id, "مرفوض")}>رفض</button></div>}</div>) : <div className="report-empty"><span>♙</span><p><b>لا توجد طلبات حتى الآن</b><small>تظهر هنا الطلبات بعد تحقق المستخدم من بريده أو حسابه الخارجي.</small></p></div>}</section></>;
  }

  function renderDays() {
    return <ResidentWorkflow role={role} accountName={currentRole.name} />;
  }

  /**
   * The sidebar was the only thing keeping a role out of a screen, so typing a
   * path reached anything. Navigation and access now read the same list.
   */
  const allowedViews = useMemo(() => {
    const ids = new Set<View>(navItems.map((item) => item.id));
    ids.add("overview");
    // Reachable from inside other screens rather than from the sidebar.
    if (role === "doctor") { ids.add("days"); ids.add("objections"); }
    if (role === "chief") { ids.add("days"); ids.add("registry"); ids.add("payments"); }
    if (role === "developer") for (const item of VIEW_ORDER) ids.add(item);
    return ids;
  }, [navItems, role]);

  function renderContent() {
    if (!allowedViews.has(view)) {
      return <section className="panel"><header className="panel-head"><div>
        <h2>لا تملك صلاحية هذه الشاشة</h2>
        <p>حسابك بصفة {currentRole.label} لا يصل إلى هذا القسم. اختر من القائمة الجانبية.</p>
      </div></header></section>;
    }
    if (view === "audit") return renderAudit();
    if (view === "payments") return renderPayments();
    if (view === "registry") return renderRegistry();
    if (view === "handover") return renderHandover();
    if (view === "attendance") return renderAttendance();
    if (view === "shifts") return <ShiftSchedule accountName={currentRole.name} notify={notify} />;
    if (view === "inpatientDays") return <InpatientDays accountName={currentRole.name} role={role} notify={notify} />;
    if (view === "personalSalary") return renderPersonalSalary();
    if (view === "settings") return renderSettings();
    if (view === "reports") return renderReports();
    if (view === "capabilities") return renderCapabilities();
    if (view === "accessRequests") return renderAccessRequests();
    if (view === "days" || view === "workLogs") return renderDays();
    if (view === "objections") return <ResidentWorkflow role={role} accountName={currentRole.name} mode="objections" />;
    if (role === "chief") return renderChiefDashboard();
    if (role === "accounts") return renderAccountsDashboard();
    if (role === "admin" || role === "developer") return renderAdminDashboard();
    return renderDoctorDashboard();
  }

  const accessModal = accessOpen &&  <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAccessOpen(false)}><form className="entry-modal access-modal" onSubmit={startAccessRequest}>
        <div className="modal-head"><div><p className="eyebrow">حساب جديد بموافقة رئيس المقيمين</p><h2>طلب دخول إلى نظام البياتي</h2><p>تحقق من هويتك أولًا، ثم يراجع رئيس المقيمين الدور والاختصاص.</p></div><button type="button" className="close-button" aria-label="إغلاق" onClick={() => setAccessOpen(false)}>×</button></div>
        <div className="demo-notice compact"><span>i</span><p><b>الحسابات التجريبية ستبقى ظاهرة</b><small>يمكن للإدارة مواصلة تجربة النظام أثناء جمع طلبات المستخدمين الحقيقيين.</small></p></div>
        <div className="access-fields">
          <label className="form-field"><span>الاسم الكامل</span><input name="fullName" required placeholder="الاسم كما سيظهر في النظام" /></label>
          <label className="form-field"><span>البريد الإلكتروني</span><input name="email" type="email" required dir="ltr" placeholder="name@gmail.com" /></label>
          <label className="form-field"><span>الدور المطلوب</span><select name="requestedRole" required defaultValue="طبيب مقيم"><option>طبيب مقيم</option><option>رئيس المقيمين</option><option>الحسابات</option><option>الإدارة العليا</option></select></label>
          <label className="form-field"><span>الاختصاص</span><select name="specialty" required defaultValue="النسائية والتوليد"><option>النسائية والتوليد</option><option>الأطفال وحديثو الولادة</option><option>التخدير</option><option>التمريض</option><option>الحسابات</option><option>التسجيل والاستعلامات</option><option>إدارة المستشفى</option></select></label>
        </div>
        <div className="oauth-actions"><button name="provider" value="email" disabled={accessSaving}><span>@</span> المتابعة عبر البريد الإلكتروني</button><button name="provider" value="google" disabled={accessSaving}><span>G</span> المتابعة عبر Google</button><button name="provider" value="apple" disabled={accessSaving}><span>●</span> المتابعة عبر Apple</button></div>
        <p className="access-footnote">لن يُفعّل الحساب بعد التحقق مباشرة؛ يبقى بحالة «بانتظار الموافقة» حتى يعتمد رئيس المقيمين الطلب.</p>
  </form></div>;


  const installGuideModal = installGuide && <div className="modal-backdrop install-guide-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setInstallGuide(null)}>
    <section className="install-guide" role="dialog" aria-modal="true" aria-label={`طريقة تثبيت البياتي على ${installGuide === "ios" ? "iPhone" : "Android"}`}>
      <button className="close-button" type="button" aria-label="إغلاق" onClick={() => setInstallGuide(null)}>×</button>
      <span className="install-guide-logo" role="img" aria-label="شعار البياتي" />
      <p className="eyebrow">تثبيت آمن من المتصفح</p>
      <h2>أضف البياتي إلى {installGuide === "ios" ? "iPhone" : "Android"}</h2>
      {installGuide === "ios" ? <ol><li><b>افتح الموقع في Safari</b><small>تأكد أنك تستخدم Safari وليس المتصفح داخل تطبيق آخر.</small></li><li><b>اضغط زر المشاركة</b><small>رمز المربع والسهم في شريط Safari.</small></li><li><b>اختر «إضافة إلى الشاشة الرئيسية»</b><small>ثم اضغط «إضافة» ليظهر شعار البياتي كتطبيق.</small></li></ol> : <ol><li><b>افتح الموقع في Chrome</b><small>من هاتف Android.</small></li><li><b>افتح قائمة ⋮</b><small>في أعلى المتصفح.</small></li><li><b>اختر «تثبيت التطبيق»</b><small>أو «إضافة إلى الشاشة الرئيسية» ثم وافق على التثبيت.</small></li></ol>}
      <p className="install-guide-note">بعد التثبيت افتح التطبيق وفعّل الإشعارات من زر الجرس لتصلك تنبيهات المناوبات.</p>
      <button className="primary-action" type="button" onClick={() => setInstallGuide(null)}>فهمت الطريقة</button>
    </section>
  </div>;

  // The reset link lands here: prove-by-email already happened, so all that is
  // left is choosing the new password.
  if (resetToken) {
    return <main className="reset-page">
      <form className="login-card reset-card" onSubmit={async (event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const newPassword = String(values.get("newPassword") || "");
        if (newPassword !== String(values.get("confirmPassword") || "")) return notify("كلمتا المرور غير متطابقتين", "info");
        const response = await fetch("/api/auth/oauth", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: resetToken, newPassword }),
        });
        const payload = await response.json();
        if (!response.ok) return notify(payload.error || "تعذر تعيين كلمة المرور", "info");
        const supabase = await getSupabaseBrowser();
        await supabase.auth.signOut();
        setResetToken("");
        window.history.replaceState(null, "", "/");
        notify(payload.message);
      }}>
        <h2>تعيين كلمة مرور جديدة</h2>
        <p className="login-intro">تحققنا من بريدك. اختر كلمة مرور جديدة لحسابك.</p>
        <div className="login-credentials">
          <label><span>كلمة المرور الجديدة</span><input name="newPassword" type="password" dir="ltr" autoComplete="new-password" minLength={8} required /></label>
          <label><span>تأكيد كلمة المرور</span><input name="confirmPassword" type="password" dir="ltr" autoComplete="new-password" minLength={8} required /></label>
        </div>
        <button className="login-submit" type="submit">حفظ كلمة المرور <span>←</span></button>
        <small className="login-security">ستُنهى جلساتك على الأجهزة الأخرى بعد التعيين.</small>
      </form>
      {toast && <div className={`toast ${toast.kind}`}><span>{toast.kind === "success" ? "✓" : "i"}</span>{toast.message}</div>}
    </main>;
  }

  if (!signedIn) {
    return <>
      <LoginLanding
        isInstalled={isInstalled}
        notificationPermission={notificationPermission}
        onLogin={signIn}
        onEmailLink={sendEmailLink}
        onRequestAccount={() => setAccessOpen(true)}
        onInstall={installApp}
        onEnableNotifications={enableNotifications}
        onToggleTheme={toggleTheme}
      />
      {issueOpen && <IssueAccount onClose={() => setIssueOpen(false)} notify={notify} />}
      {accessModal}
      {installGuideModal}
      {toast && <div className={`toast ${toast.kind}`}><span>{toast.kind === "success" ? "✓" : "i"}</span>{toast.message}</div>}
    </>;
  }

  return (
    <div className={`app-shell ${sidebarExpanded ? "sidebar-open" : "sidebar-collapsed"}`}>
      <aside className="sidebar" aria-label="القائمة الجانبية">
        <div className="brand"><span className="brand-mark" role="img" aria-label="شعار نظام البياتي" /><div><b>البياتي</b><small>النظام الطبي الذكي</small></div></div>
        <button className="sidebar-toggle" data-label={sidebarExpanded ? "طي القائمة" : "إظهار القائمة"} type="button" aria-expanded={sidebarExpanded} aria-label={sidebarExpanded ? "طي القائمة الجانبية" : "إظهار القائمة الجانبية"} onClick={() => setSidebarExpanded((expanded) => !expanded)}><Icon>{sidebarExpanded ? "→" : "←"}</Icon><span>{sidebarExpanded ? "طي القائمة" : "إظهار القائمة"}</span></button>
        <nav aria-label="القائمة الرئيسية">
          <p>القائمة الرئيسية</p>
          {navItems.map((item) => <button key={item.id} data-label={item.label} title={!sidebarExpanded ? item.label : undefined} className={view === item.id ? "active" : ""} onClick={() => navigateTo(item.id)}><Icon>{item.icon}</Icon><span>{item.label}</span>{item.id === "audit" && auditRows.length > 0 && <i className="nav-count">{auditRows.length}</i>}</button>)}
        </nav>
        <div className="sidebar-bottom"><button data-label="مركز المساعدة" title={!sidebarExpanded ? "مركز المساعدة" : undefined} onClick={() => navigateTo("settings")}><Icon>؟</Icon><span>مركز المساعدة</span></button><button data-label="تسجيل الخروج" title={!sidebarExpanded ? "تسجيل الخروج" : undefined} onClick={signOut}><Icon>↪</Icon><span>تسجيل الخروج</span></button><div className="secure-chip"><span>✓</span><p><b>بياناتك محمية</b><small>آخر مزامنة: الآن</small></p></div></div>
      </aside>
      {sidebarExpanded && <button type="button" className="sidebar-scrim" aria-label="إغلاق القائمة" onClick={() => setSidebarExpanded(false)} />}

      <div className="main-column">
        <header className="topbar">
          <div className="mobile-brand"><button type="button" className="menu-trigger" aria-label="إظهار القائمة الجانبية" onClick={() => setSidebarExpanded(true)}>☰</button><span className="brand-mark" role="img" aria-label="شعار نظام البياتي" /><b>البياتي</b></div>
          <label className="global-search"><span aria-hidden="true">⌕</span><input aria-label="البحث في النظام" value={globalSearch} onChange={(event) => { setGlobalSearch(event.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)} onKeyDown={(event) => { if (event.key === "Enter" && globalSearchResults[0]) activateSearchResult(globalSearchResults[0]); if (event.key === "Escape") setSearchOpen(false); }} placeholder="ابحث بالاسم أو رقم الملف أو القسم..." />{searchOpen && globalSearch.trim().length >= 2 && <div className="global-search-results" role="listbox">{globalSearchResults.length ? globalSearchResults.map((result) => <button type="button" role="option" aria-selected="false" key={result.id} onMouseDown={(event) => event.preventDefault()} onClick={() => activateSearchResult(result)}><span>{result.kind === "account" ? "ط" : result.kind === "patient" ? "م" : "←"}</span><p><b>{result.label}</b><small>{result.meta}</small></p></button>) : <p className="search-empty"><b>لا توجد نتيجة مطابقة</b><small>جرّب الاسم الكامل أو رقم الملف.</small></p>}</div>}</label>
          <div className="top-actions">{isDeveloper && <span className="demo-chip">معاينة المطور</span>}<div className="header-tabs"><button className="theme-button header-tab" aria-label="تبديل الوضع الليلي والنهاري" title="الوضع الليلي / النهاري" onClick={toggleTheme}><span className="theme-sun">☀</span><span className="theme-moon">☾</span><span className="tab-label"><i>المظهر</i></span></button><div className="notification-wrap"><button
              className={`icon-button notification-button header-tab${notificationPermission === "granted" ? " enabled" : ""}`}
              aria-label={notificationPermission === "granted" ? "مركز الإشعارات" : "تفعيل إشعارات الجهاز"}
              title={notificationPermission === "granted" ? "مركز الإشعارات" : "اضغط لتفعيل إشعارات الجهاز"}
              aria-expanded={notificationsOpen}
              disabled={notificationPermission === "unsupported"}
              onClick={() => {
                // One tap does the obvious thing: turn notifications on if they
                // are off, and open the centre once they are already on.
                if (notificationPermission === "granted") setNotificationsOpen((open) => !open);
                else enableNotifications();
              }}
            ><span aria-hidden="true">🔔</span><i /><span className="tab-label"><i>{notificationPermission === "granted" ? "الإشعارات" : "تفعيل التنبيهات"}</i></span></button>{notificationsOpen && <section className="notifications-panel"><div><b>مركز الإشعارات</b><small>{notificationPermission === "granted" ? "إشعارات الجهاز مفعّلة" : "تحتاج تفعيل إشعارات الجهاز"}</small></div>{(role === "admin" || role === "developer") && <article className="report-notification"><span>XL</span><p><b>تقرير الإدارة – آب 2026</b><small>Excel متكامل: لوحة، تشغيل يومي، أطباء ومالية.</small></p><a href={ADMIN_REPORT_URL} download="تقرير الإدارة العليا - آب 2026.xlsx">تنزيل</a></article>}<article><span>⇄</span><p><b>تسليم المناوبة</b><small>قائمة المرضى المستلمين جاهزة للمتابعة.</small></p></article><article><span>✓</span><p><b>آخر مزامنة مكتملة</b><small>تم حفظ تغييرات {currentRole.name} مع سجل المنفذ.</small></p></article>{notificationPermission !== "granted" && <button onClick={enableNotifications} disabled={notificationPermission === "unsupported"}>تفعيل إشعارات الجهاز</button>}</section>}</div></div><span className="divider" /><div className="role-picker">
              {isDeveloper && <select aria-label="معاينة حساب آخر" value={activeAccountId} onChange={(event) => changeAccount(event.target.value)}>{demoAccounts.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.label}</option>)}</select>}
              <AccountMenu
                name={currentRole.name}
                label={currentRole.label}
                canIssueAccounts={["رئيس المقيمين", "الإدارة العليا", "مطور النظام"].includes(sessionUser?.role || "")}
                onIssueAccount={() => setIssueOpen(true)}
                onSignOut={signOut}
                notify={notify}
              />
            </div></div>
        </header>
        <main>{renderContent()}</main>
        <nav
          className="mobile-nav"
          aria-label="قائمة الهاتف"
          // The pill slides to the active tab: one custom property drives the
          // whole animation, so no layout is recalculated on every tap.
          style={{
            "--tab-count": mobileTabs.length,
            "--tab-index": Math.max(0, mobileTabs.findIndex((item) => item.id === view)),
          } as CSSProperties}
        >
          <span className={`mobile-nav-pill${mobileTabs.some((item) => item.id === view) ? "" : " hidden"}`} aria-hidden="true" />
          {mobileTabs.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => navigateTo(item.id)}
            >
              <Icon>{item.icon}</Icon>
              <small>{item.label.split(" ")[0]}</small>
            </button>
          ))}
        </nav>
      </div>

      {issueOpen && <IssueAccount onClose={() => setIssueOpen(false)} notify={notify} />}
      {accessModal}
      {installGuideModal}
      {toast && <div className={`toast ${toast.kind}`}><span>{toast.kind === "success" ? "✓" : "i"}</span>{toast.message}</div>}
    </div>
  );
}
