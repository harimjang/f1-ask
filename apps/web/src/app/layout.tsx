import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { DEFAULT_LOCALE } from "@f1/domain";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

// PWA 설치형 앱 메타 (docs/30-app-service.md §1). manifest 는 app/manifest.ts.
export const metadata: Metadata = {
  title: "Racepilot",
  description: "Understand Formula 1 races in real time.",
  applicationName: "Racepilot",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Racepilot",
  },
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
};

// viewport-fit=cover 로 노치/홈 인디케이터 영역까지 배경을 확장하고,
// 세이프 에어리어 유틸(pt-safe 등)이 동작하게 한다.
export const viewport: Viewport = {
  themeColor: "#0a0e1a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// 루트 레이아웃. lang 은 [locale] 세그먼트에서 클라이언트로 갱신한다.
const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang={DEFAULT_LOCALE} suppressHydrationWarning>
    <head>
      {/* Pretendard — 한글 최적화 가변 폰트(dynamic-subset: 쓰는 글자만 로드). */}
      <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css"
      />
    </head>
    <body className="min-h-screen antialiased">
      <ServiceWorkerRegister />
      {children}
    </body>
  </html>
);

export default RootLayout;
