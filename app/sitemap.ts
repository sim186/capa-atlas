import type { MetadataRoute } from "next";
import { loadGraph, nodePath } from "@/lib/atlasData";
import { SITE_COPY, SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

/** Both atlases, then every node page, each listed with its other-language twin. */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = [
    { it: SITE_COPY.it.path, en: SITE_COPY.en.path, priority: 1 },
    ...(loadGraph("it")?.nodes ?? []).map((node) => ({
      it: nodePath(node, "it"),
      en: nodePath(node, "en"),
      priority: node.group === "song" ? 0.6 : 0.8,
    })),
  ];
  return pages.flatMap(({ priority, ...paths }) => {
    const languages = { it: `${SITE_URL}${paths.it}`, en: `${SITE_URL}${paths.en}` };
    return Object.values(languages).map((url) => ({
      url,
      changeFrequency: "monthly" as const,
      priority,
      alternates: { languages },
    }));
  });
}
