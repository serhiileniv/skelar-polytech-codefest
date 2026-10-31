import type { Metadata } from "next";
import { Geist_Mono, Instrument_Sans } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Resolly · PawPlan support",
  description:
    "Investigate support cases: can the customer fix it, or is it on us?",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="bg-canvas flex min-h-full flex-col font-sans">
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
