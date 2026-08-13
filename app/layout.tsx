import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.scss";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Recruitment OS",
  description: "AI-Powered Recruitment Operating System",
};

// Explicit props type rather than Next's generated `LayoutProps` global, so
// `tsc --noEmit` typechecks without first running a build to emit .next/types.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
