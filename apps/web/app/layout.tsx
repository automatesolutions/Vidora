import type { Metadata, Viewport } from "next";
import { Inter, Mona_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Body face (DESIGN.md): Inter. Display face: Mona Sans, DESIGN.md's named substitute for Degular Display.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const monaSans = Mona_Sans({ variable: "--font-mona-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: { default: "Vidora", template: "%s · Vidora" },
  description:
    "Vidora makes videos for your YouTube and TikTok channels and posts only the ones you approve.",
  applicationName: "Vidora",
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffefb" },
    { media: "(prefers-color-scheme: dark)", color: "#201515" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${monaSans.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
