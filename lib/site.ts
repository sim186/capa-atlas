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

/**
 * Contact address for press and rights queries.
 *
 * Split into three variables and kept out of the repository: locally they live
 * in .env.local (gitignored), on GitHub in Actions secrets read by
 * .github/workflows/deploy.yml. The panel never displays the address and the
 * static HTML never contains it as text: the pieces are joined at runtime, only
 * when the contact button is pressed, and go straight into a `mailto:`. Bots
 * that fetch and parse pages (the ones that build spam lists) find nothing, and
 * there is nothing on screen to copy into a mailing list.
 *
 * The built bundle does carry the joined address, because GitHub Pages serves
 * that bundle to anyone. This keeps the address out of the repo and out of the
 * page markup; it cannot hide it from someone willing to read the JS.
 */
const CONTACT_ENV = {
  user: process.env.NEXT_PUBLIC_CONTACT_USER,
  domain: process.env.NEXT_PUBLIC_CONTACT_DOMAIN,
  tld: process.env.NEXT_PUBLIC_CONTACT_TLD,
};

/** null when the address is not configured, so the panel can drop the button. */
export const contactEmail = (): string | null => {
  const { user, domain, tld } = CONTACT_ENV;
  if (!user || !domain || !tld) return null;
  return `${user}@${domain}.${tld}`;
};
