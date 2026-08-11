import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "نظام البياتي الطبي الذكي",
    short_name: "البياتي",
    description: "إدارة ذكية لعمل الأطباء وتسليم المناوبات والحسابات الطبية.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0e241e",
    theme_color: "#0b5144",
    lang: "ar",
    dir: "rtl",
    categories: ["medical", "productivity", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
