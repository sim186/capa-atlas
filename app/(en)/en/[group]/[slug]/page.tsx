import NodePage, { metadataFor, staticParams } from "@/components/NodePage";

export const dynamicParams = false;
export const generateStaticParams = staticParams("en");
export const generateMetadata = metadataFor("en");

export default function Page({ params }: { params: Promise<{ group: string; slug: string }> }) {
  return <NodePage locale="en" params={params} />;
}
