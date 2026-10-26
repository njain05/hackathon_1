import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Next } from "next/font/google";
import ServerBanner from "@/components/ServerBanner";
import "./globals.css";

const atkinson = Atkinson_Hyperlegible_Next({
  variable: "--font-atkinson",
  subsets: ["latin"],
  adjustFontFallback: false, // Next has no fallback metrics for this font yet
});

export const metadata: Metadata = {
  title: "College Timetable",
  description: "Clash-free timetables and hall bookings for any college",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${atkinson.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ServerBanner />
        {children}
      </body>
    </html>
  );
}
