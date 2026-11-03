import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stage 1 REST Multi-Server POC",
  description: "Next.js client calling multiple Fastify REST servers"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}