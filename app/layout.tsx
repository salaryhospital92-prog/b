import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const imageUrl = `${protocol}://${host}/og-registration.png`;

  return {
    title: "نظام البياتي الطبي الذكي",
    applicationName: "نظام البياتي الطبي الذكي",
    description: "منصة ذكية لإدارة عمل وحسابات الأطباء المقيمين بدقة وشفافية.",
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
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
    openGraph: {
      title: "نظام البياتي الطبي الذكي",
      description: "تسجيل أدق. عمل أسهل.",
      locale: "ar_IQ",
      type: "website",
      images: [{ url: imageUrl, width: 1672, height: 941, alt: "نظام البياتي الطبي الذكي" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "نظام البياتي الطبي الذكي",
      description: "تسجيل أدق. عمل أسهل.",
      images: [imageUrl],
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
