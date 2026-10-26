import { nodePath } from "@/lib/atlasData";
import type { GraphNode } from "@/lib/graph";
import type { Locale } from "@/lib/i18n";
import { SITE_COPY, SITE_NAME, SITE_URL } from "@/lib/site";

const ARTIST = { "@type": "MusicGroup", name: "Caparezza" };

/**
 * schema.org markup for one node page: a WebPage whose main entity is the
 * album or recording when the node is one, else a plain Thing, plus a
 * breadcrumb back to the atlas.
 */
export function nodeJsonLd(
  node: GraphNode,
  locale: Locale,
  { description, albumNode }: { description: string; albumNode?: GraphNode }
) {
  const url = `${SITE_URL}${nodePath(node, locale)}`;
  const base = { name: node.label, url, ...(node.cover ? { image: node.cover } : {}) };
  const mainEntity =
    node.group === "album"
      ? {
          "@type": "MusicAlbum",
          ...base,
          byArtist: ARTIST,
          ...(node.release ? { datePublished: node.release } : {}),
          ...(node.tracks?.length
            ? {
                numTracks: node.tracks.length,
                track: node.tracks.map((track, position) => ({
                  "@type": "MusicRecording",
                  position: position + 1,
                  name: track.label,
                })),
              }
            : {}),
        }
      : node.group === "song"
        ? {
            "@type": "MusicRecording",
            ...base,
            byArtist: ARTIST,
            ...(node.album
              ? {
                  inAlbum: {
                    "@type": "MusicAlbum",
                    name: node.album,
                    ...(albumNode ? { url: `${SITE_URL}${nodePath(albumNode, locale)}` } : {}),
                  },
                }
              : {}),
          }
        : { "@type": "Thing", ...base };
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        url,
        name: node.label,
        description,
        inLanguage: locale,
        isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${SITE_URL}${SITE_COPY[locale].path}` },
        mainEntity,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${SITE_URL}${SITE_COPY[locale].path}` },
          { "@type": "ListItem", position: 2, name: node.label, item: url },
        ],
      },
    ],
  };
}

/** JSON for an inline <script>: "<" escaped so text can't close the tag. */
export const jsonLdString = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
