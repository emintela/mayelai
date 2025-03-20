import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs"; // Import ClerkProvider
import { ThemeProvider } from "@/components/theme-provider"; // Import ThemeProvider
import { cn } from "@/lib/utils"; // Import cn if you are using shadcn

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mayel AI",
  description: "AI Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!} // Pass your publishable key
      // Add other ClerkProvider props as needed (e.g., signInUrl, etc.)
    >
      <html lang="en">
        <body
          className={cn(
            geistSans.variable,
            geistMono.variable,
            "antialiased"
          )}
        >
          
            {children}
          
        </body>
      </html>
    </ClerkProvider>
  );
}
