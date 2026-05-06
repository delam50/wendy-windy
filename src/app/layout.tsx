import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Windy Ridge Chiropractic",
  description: "A virtual care assistant for Windy Ridge Chiropractic.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
