import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Verity | Loan Data Verification Copilot",
  description: "AI-assisted loan data verification, exception handling and auditability console."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
