import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const origin = `${protocol}://${host}`;
  // The app icon, not a screenshot: WhatsApp and Telegram render the square
  // thumbnail beside the link, so a shared link looks like the installed app.
  const iconUrl = `${origin}/icons/icon-512.png`;
  const imageUrl = `${origin}/og-registration.png`;

  return {
    title: "نظام البياتي الطبي الذكي",
    applicationName: "نظام البياتي الطبي الذكي",
    description: "منصة ذكية لإدارة عمل وحسابات الأطباء المقيمين بدقة وشفافية.",
    manifest: "/manifest.webmanifest",
    icons: {
      // A real .ico first: browsers ask for /favicon.ico before reading any
      // metadata, and the catch-all route would otherwise answer it with HTML.
      icon: [
        { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
        { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    appleWebApp: {
      capable: true,
      title: "البياتي",
      statusBarStyle: "black-translucent",
    },
    metadataBase: new URL(origin),
    openGraph: {
      title: "نظام البياتي الطبي الذكي",
      description: "تسجيل أدق. عمل أسهل.",
      locale: "ar_IQ",
      type: "website",
      siteName: "البياتي",
      url: origin,
      images: [
        { url: iconUrl, width: 512, height: 512, alt: "أيقونة تطبيق البياتي" },
        { url: imageUrl, width: 1672, height: 941, alt: "نظام البياتي الطبي الذكي" },
      ],
    },
    twitter: {
      card: "summary",
      title: "نظام البياتي الطبي الذكي",
      description: "تسجيل أدق. عمل أسهل.",
      images: [iconUrl],
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#0b5144",
  colorScheme: "light dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
