import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.truepeak.space"),
  title: {
    default: "True Peak | Automated Demo Submission & A&R Workflow",
    template: "%s | True Peak",
  },
  description:
    "Streamline your music label's inbox. Automatically screen track demos for digital clipping, phase issues, and dynamic range with our automated Kanban CRM.",
  keywords: [
    "demo submission platform",
    "music label crm",
    "a&r workflow automation",
    "record label software",
    "automated audio gatekeeper",
    "automated demo vetting for record labels",
    "how to manage demo submissions electronic music",
    "music demo inbox manager tool",
    "software for a&r track curation",
    "automatic audio quality control for labels",
    "audio true peak analysis online",
    "automated mono compatibility check",
    "track crest factor analysis api",
    "lossless audio validation software",
  ],
  openGraph: {
    title: "True Peak | Automated Demo Submission & A&R Workflow",
    description:
      "Streamline your music label's inbox. Automatically screen track demos for digital clipping, phase issues, and dynamic range with our automated Kanban CRM.",
    url: "https://www.truepeak.space",
    siteName: "True Peak",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "True Peak | Automated Demo Submission & A&R Workflow",
    description:
      "Streamline your music label's inbox. Automatically screen track demos for digital clipping, phase issues, and dynamic range with our automated Kanban CRM.",
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/favicon.png",
  },
};

import { ToastProvider } from "@/components/ui/toast";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <body
        className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} font-body antialiased`}
      >
        <ThemeProvider>
          <LanguageProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
