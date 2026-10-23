import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recoverly | Sales Recovery Demo",
  description: "An independent fake-data demo of sales recovery workflows.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
