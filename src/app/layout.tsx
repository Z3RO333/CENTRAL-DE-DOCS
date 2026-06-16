import type { Metadata } from "next";
import { Geist, Geist_Mono, Poppins } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { AuthProvider } from "@/components/AuthProvider";
import { SimulacaoProvider } from "@/components/SimulacaoProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: "Central de Documentos",
  description: "Portal interno para envio e assinatura de documentos.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${poppins.className} font-semibold ${poppins.variable} ${geistSans.variable} ${geistMono.variable} bg-background text-foreground antialiased`}
      >
        <AuthProvider>
          <SimulacaoProvider>
            <AppShell>{children}</AppShell>
          </SimulacaoProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
