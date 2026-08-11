"use client";

import { useEffect, useState } from "react";



type LoginLandingProps = {
  isInstalled: boolean;
  notificationPermission: NotificationPermission | "unsupported";
  onLogin: (username: string, password: string) => Promise<string | null>;
  onProviderLogin: (provider: "google" | "apple") => Promise<string | null>;
  onEmailLink: (email: string, purpose: "signin" | "reset") => Promise<string | null>;
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

export default function LoginLanding({ isInstalled, notificationPermission, onLogin, onProviderLogin, onEmailLink, onRequestAccount, onInstall, onEnableNotifications, onToggleTheme }: LoginLandingProps) {
  const [mode, setMode] = useState<"password" | "email" | "reset">("password");
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [featureIndex, setFeatureIndex] = useState(0);
  const [visibleCharacters, setVisibleCharacters] = useState(0);
  const [phase, setPhase] = useState<"typing" | "showing" | "deleting">("typing");
  const [username, setUsername] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const activeFeature = features[featureIndex];

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
          {/* An invisible copy of every headline holds the box at its tallest, so
              typing never reflows the page under the login fields on a phone. */}
          <h1 aria-live="polite">
            <span className="type-sizer" aria-hidden="true">{features.map((feature) => <span key={feature.title}>{feature.title}</span>)}</span>
            <span className="type-line">{activeFeature.title.slice(0, visibleCharacters)}<i aria-hidden="true" /></span>
          </h1>
          <p className={visibleCharacters === activeFeature.title.length && phase !== "deleting" ? "visible" : ""}>
            <span className="type-sizer" aria-hidden="true">{features.map((feature) => <span key={feature.title}>{feature.description}</span>)}</span>
            <span>{activeFeature.description}</span>
          </p>
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
        <form className="login-card" onSubmit={async (event) => {
          event.preventDefault();
          setSigningIn(true);
          setNotice("");
          // The server decides; the browser never holds a password to compare against.
          const failure = mode === "password"
            ? await onLogin(username, password)
            : await onEmailLink(email, mode === "reset" ? "reset" : "signin");
          setSigningIn(false);
          if (failure) { setLoginError(failure); if (mode === "password") setPassword(""); }
          else if (mode !== "password") setNotice(`أرسلنا رابطًا إلى ${email}. افتحه من هذا الجهاز.`);
        }}>
          <h2>{mode === "reset" ? "استعادة كلمة المرور" : "تسجيل الدخول"}</h2>
          <p className="login-intro">{mode === "password"
            ? "أدخل اسم المستخدم وكلمة المرور، أو ادخل بحسابك المعتمد مباشرة."
            : mode === "email"
              ? "سنرسل رابط دخول إلى بريدك المعتمد في النظام."
              : "أدخل بريدك المعتمد وسنرسل رابطًا لتعيين كلمة مرور جديدة."}</p>
          {mode === "password" ? (
            <div className="login-credentials">
              <label><span>اسم المستخدم</span><input dir="ltr" autoComplete="username" value={username} onChange={(event) => { setUsername(event.target.value); setLoginError(""); }} required /></label>
              <label>
                <span>كلمة المرور</span>
                <div className="password-field">
                  <input dir="ltr" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value); setLoginError(""); }} required placeholder="أدخل كلمة المرور" />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}>{showPassword ? "إخفاء" : "إظهار"}</button>
                </div>
              </label>
              <button className="login-forgot" type="button" onClick={() => { setMode("reset"); setNotice(""); setLoginError(""); }}>نسيت كلمة المرور؟</button>
            </div>
          ) : (
            <div className="login-credentials">
              <label><span>البريد الإلكتروني المعتمد</span><input dir="ltr" type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setLoginError(""); }} required placeholder="name@example.com" /></label>
              <button className="login-forgot" type="button" onClick={() => { setMode("password"); setNotice(""); setLoginError(""); }}>الرجوع إلى الدخول بكلمة المرور</button>
            </div>
          )}
          {notice && <p className="login-notice" role="status">{notice}</p>}
          {loginError && <p className="login-error" role="alert">{loginError}</p>}
          <button className="login-submit" type="submit" disabled={signingIn}>{signingIn
            ? "جارٍ التنفيذ..."
            : mode === "password" ? "الدخول إلى الحساب" : mode === "email" ? "أرسل رابط الدخول" : "أرسل رابط الاستعادة"} <span>←</span></button>

          {mode === "password" && (
            <>
              <div className="login-divider"><span>أو ادخل مباشرة عبر</span></div>
              <div className="login-providers">
                <button type="button" disabled={signingIn} onClick={async () => { setLoginError(""); const failure = await onProviderLogin("google"); if (failure) setLoginError(failure); }}><span className="provider-mark google">G</span>Google</button>
                <button type="button" disabled={signingIn} onClick={async () => { setLoginError(""); const failure = await onProviderLogin("apple"); if (failure) setLoginError(failure); }}><span className="provider-mark apple"></span>Apple</button>
                <button type="button" disabled={signingIn} onClick={() => { setMode("email"); setNotice(""); setLoginError(""); }}><span className="provider-mark email">@</span>البريد</button>
              </div>
            </>
          )}
          <button className="login-request" type="button" onClick={onRequestAccount}>ليس لديك حساب؟ طلب حساب جديد</button>
          <div className="login-notification-row"><span aria-hidden="true">🔔</span><p><b>إشعارات المناوبات</b><small>{notificationPermission === "granted" ? "مفعّلة على هذا الجهاز" : "فعّلها ليصلك ما يحتاج إجراءك"}</small></p><button type="button" onClick={onEnableNotifications} disabled={notificationPermission === "granted" || notificationPermission === "unsupported"}>{notificationPermission === "granted" ? "مفعّلة" : "تفعيل"}</button></div>
          <small className="login-security">كلمة المرور تُفحص على الخادم ولا تُحفظ في المتصفح. بعد خمس محاولات خاطئة يتوقف الدخول ربع ساعة.</small>
        </form>
      </section>
    </main>
  );
}
