import type { ReactNode } from "react";
import RootDocument, { siteMetadata } from "@/components/RootDocument";

export { viewport } from "@/components/RootDocument";
export const metadata = siteMetadata("en");

export default function EnglishLayout({ children }: { children: ReactNode }) {
  return <RootDocument locale="en">{children}</RootDocument>;
}
