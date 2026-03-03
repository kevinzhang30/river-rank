import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RiverRank",
  description: "Ranked heads-up poker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        {/* Prevent flash: apply persisted theme before first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme')||'dark';document.documentElement.dataset.theme=t;var d=localStorage.getItem('deck')||'2color';document.documentElement.dataset.deck=d;}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
