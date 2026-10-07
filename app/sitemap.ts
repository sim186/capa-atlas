import type { MetadataRoute } from "next";
import { SITE_COPY, SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const languages = { it: `${SITE_URL}${SITE_COPY.it.path}`, en: `${SITE_URL}${SITE_COPY.en.path}` };
  return Object.values(languages).map((url) => ({
    url,
    changeFrequency: "monthly",
    priority: 1,
    alternates: { languages },
  }));
}
