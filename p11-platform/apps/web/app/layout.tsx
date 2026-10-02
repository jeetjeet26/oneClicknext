import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { ToastProvider, ThemeProvider } from "@/components/ui";
import { themeBootstrapScript } from "@/components/ui/theme-script";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const p11Heading = localFont({
  src: "./fonts/InterTight-Variable.woff2",
  variable: "--font-p11-heading",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "P11 Console",
  icons: { icon: [{ url: "/branding/p11-icon.svg", type: "image/svg+xml" }] },
  description: "Unified platform for P11 autonomous agency products",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          id="p11-theme-bootstrap"
          dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${p11Heading.variable} antialiased`}
      >
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
