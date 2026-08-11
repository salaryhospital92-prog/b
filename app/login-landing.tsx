"use client";

import { useEffect, useMemo, useState } from "react";

type LoginAccount = { id: string; label: string; name: string };

type LoginLandingProps = {
  accounts: LoginAccount[];
  selectedId: string;
  isInstalled: boolean;
  notificationPermission: NotificationPermission | "unsupported";
  onSelect: (id: string) => void;
  onLogin: () => void;
  onRequestAccount: () => void;
  onInstall: (platform: "ios" | "android") => void;
  onEnableNotifications: () => void;
  onToggleTheme: () => void;
};

const features = [
  { title: "ملف مستقل لكل طبيب", description: "حساب شخصي لا يختلط بغيره: المناوبات والحالات والإثباتات والراتب والاعتراضات محفوظة باسم صاحبها." },
  { title: "تسليم مناوبة بلا فقدان متابعة", description: "يعرف الطبيب التالي المرضى الذين استلمهم وما تبقى لكل حالة، مع توثيق وقت ومسؤولية التسليم." },
  { title: "حسابات واضحة وقابلة للتدقيق", description: "كل تعديل مالي مرتبط بمن أجراه، مع كشف دقيق وآلية اعتراض ومراجعة عادلة." },
  { title: "تقارير وإشعارات في وقتها", description: "ملخصات يومية وأسبوعية وشهرية، وتنبيهات مهمة تصل إلى جهاز الطبيب بعد تفعيلها." },
];

export default function LoginLanding({ accounts, selectedId, isInstalled, notificationPermission, onSelect, onLogin, onRequestAccount, onInstall, onEnableNotifications, onToggleTheme }: LoginLandingProps) {
  const [featureIndex, setFeatureIndex] = useState(0);
  const [visibleCharacters, setVisibleCharacters] = useState(0);
  const [phase, setPhase] = useState<"typing" | "showing" | "deleting">("typing");
  const activeFeature = features[featureIndex];
  const selectedAccount = useMemo(() => accounts.find((account) => account.id === selectedId) || accounts[0], [accounts, selectedId]);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      const reducedMotionTimer = window.setTimeout(() => setVisibleCharacters(activeFeature.title.length), 0);
      return () => window.clearTimeout(reducedMotionTimer);
    }
    let delay = 65;
    if (phase === "typing" && visibleCharacters >= activeFeature.title.length) delay = 2600;
    if (phase === "showing") delay = 350;
    if (phase === "deleting") delay = 34;
    const timer = window.setTimeout(() => {
      if (phase === "typing" && visibleCharacters < activeFeature.title.length) {
        setVisibleCharacters((count) => count + 1);
      } else if (phase === "typing") {
        setPhase("showing");
      } else if (phase === "showing") {
        setPhase("deleting");
      } else if (visibleCharacters > 0) {
        setVisibleCharacters((count) => count - 1);
      } else {
        setFeatureIndex((index) => (index + 1) % features.length);
        setPhase("typing");
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [activeFeature.title, phase, visibleCharacters]);

  return (
    <main className="login-page">
      <section className="login-showcase" aria-label="مميزات نظام البياتي">
        <header className="login-brand"><span className="brand-mark" role="img" aria-label="شعار نظام البياتي" /><div><b>البياتي</b><small>النظام الطبي الذكي</small></div></header>
        <div className="login-feature-copy">
          <span className="login-kicker">المستشفى أوضح عندما تكون المعلومة في مكانها</span>
          <h1 aria-live="polite"><span>{activeFeature.title.slice(0, visibleCharacters)}</span><i aria-hidden="true" /></h1>
          <p className={visibleCharacters === activeFeature.title.length && phase !== "deleting" ? "visible" : ""}>{activeFeature.description}</p>
          <div className="feature-progress" aria-label={`الميزة ${featureIndex + 1} من ${features.length}`}>{features.map((_, index) => <i className={index === featureIndex ? "active" : ""} key={index} />)}</div>
        </div>
        <div className="install-ready-card">
          <span className="ready-mark">✓</span>
          <div><b>{isInstalled ? "البياتي مثبت على هذا الجهاز" : "جاهز للتثبيت كتطبيق"}</b><small>وصول أسرع وتجربة كاملة على الهاتف والكمبيوتر.</small></div>
          {!isInstalled && <div className="install-actions"><button onClick={() => onInstall("android")}>Android</button><button onClick={() => onInstall("ios")}>iPhone</button></div>}
        </div>
      </section>

      <section className="login-access">
        <div className="login-toolbar"><span>نسخة المعاينة</span><button type="button" onClick={onToggleTheme} aria-label="تبديل الوضع الليلي والنهاري">◐</button></div>
        <div className="login-card">
          <div className="login-card-head"><span className="login-mini-logo" /><p><small>مرحبًا بك في</small><b>نظام البياتي</b></p></div>
          <h2>تسجيل الدخول</h2>
          <p className="login-intro">اختر حساب المعاينة لتجربة صلاحياته وبياناته المستقلة.</p>
          <label className="login-account-field"><span>الحساب التجريبي</span><select value={selectedId} onChange={(event) => onSelect(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} — {account.label}</option>)}</select></label>
          <div className="selected-account-preview"><span>{selectedAccount.name.replace("د. ", "")[0] || "ب"}</span><p><b>{selectedAccount.name}</b><small>{selectedAccount.label} · بيانات مستقلة</small></p><i>جاهز</i></div>
          <button className="login-submit" type="button" onClick={onLogin}>الدخول إلى الحساب <span>←</span></button>
          <button className="login-request" type="button" onClick={onRequestAccount}>ليس لديك حساب؟ طلب حساب جديد</button>
          <div className="login-notification-row"><span aria-hidden="true">🔔</span><p><b>إشعارات المناوبات</b><small>{notificationPermission === "granted" ? "مفعّلة على هذا الجهاز" : "فعّلها ليصلك ما يحتاج إجراءك"}</small></p><button type="button" onClick={onEnableNotifications} disabled={notificationPermission === "granted" || notificationPermission === "unsupported"}>{notificationPermission === "granted" ? "مفعّلة" : "تفعيل"}</button></div>
          <small className="login-security">النسخة الرسمية تعتمد البريد الموافق عليه من رئيس المقيمين. الحسابات التجريبية ظاهرة مؤقتًا للاستماع إلى ملاحظات الإدارة.</small>
        </div>
      </section>
    </main>
  );
}
