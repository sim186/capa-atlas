import type { Locale } from "@/lib/i18n";

export const SITE_URL = "https://sim186.github.io/capa-atlas";
export const SITE_NAME = "The Capa Atlas";

/** Per-language copy for <head>, the crawler view and social cards. */
export const SITE_COPY: Record<
  Locale,
  { path: string; tagline: string; description: string; ogAlt: string; ogLocale: string; keywords: string[] }
> = {
  it: {
    path: "/",
    tagline: "L'universo di Caparezza",
    description:
      "Persone, eventi e idee che tornano di album in album: la mappa dei riferimenti nei testi di Caparezza. Progetto non ufficiale.",
    ogAlt: "persone, eventi e idee che tornano di album in album",
    ogLocale: "it_IT",
    keywords: ["Caparezza", "Atlas", "universo", "testi", "riferimenti", "citazioni", "atlante", "Genius"],
  },
  en: {
    path: "/en",
    tagline: "Caparezza's universe",
    description:
      "People, events and ideas that come back from album to album: a map of the references in Caparezza's lyrics. Unofficial fan project.",
    ogAlt: "people, events and ideas that come back from album to album",
    ogLocale: "en_GB",
    keywords: ["Caparezza", "Atlas", "lyrics", "references", "Italian rap", "Genius", "map"],
  },
};

export const siteTitle = (locale: Locale) => `${SITE_NAME} — ${SITE_COPY[locale].tagline}`;
