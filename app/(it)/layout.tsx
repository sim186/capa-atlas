import type { ReactNode } from "react";
import RootDocument, { siteMetadata } from "@/components/RootDocument";

export { viewport } from "@/components/RootDocument";
export const metadata = siteMetadata("it");

export default function ItalianLayout({ children }: { children: ReactNode }) {
  return <RootDocument locale="it">{children}</RootDocument>;
}
