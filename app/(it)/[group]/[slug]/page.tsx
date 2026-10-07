import NodePage, { metadataFor, staticParams } from "@/components/NodePage";

export const dynamicParams = false;
export const generateStaticParams = staticParams("it");
export const generateMetadata = metadataFor("it");

export default function Page({ params }: { params: Promise<{ group: string; slug: string }> }) {
  return <NodePage locale="it" params={params} />;
}
