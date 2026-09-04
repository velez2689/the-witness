import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Witness",
  description: "Payer call memory. Records what the payer said, and remembers it across calls.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
