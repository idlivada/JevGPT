import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "JevGPT",
  description: "A word-by-word chat assistant built on TypeSafe's Jev System One model",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Extensions such as Dark Reader add attributes to <html> before hydration. This only ignores
    // attribute mismatches on this element, not its children.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
