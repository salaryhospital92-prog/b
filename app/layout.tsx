import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const imageUrl = `${protocol}://${host}/og.png`;

  return {
    title: "نظام البياتي الطبي الذكي",
    description: "منصة ذكية لإدارة عمل وحسابات الأطباء المقيمين بدقة وشفافية.",
    openGraph: {
      title: "نظام البياتي الطبي الذكي",
      description: "عمل أسهل. حساب أدق. قرار أسرع.",
      locale: "ar_IQ",
      type: "website",
      images: [{ url: imageUrl, width: 1672, height: 941, alt: "نظام البياتي الطبي الذكي" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "نظام البياتي الطبي الذكي",
      description: "عمل أسهل. حساب أدق. قرار أسرع.",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
