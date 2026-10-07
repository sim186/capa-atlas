import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import GroupGlyph from "@/components/GroupGlyph";
import { pageMetadata } from "@/components/RootDocument";
import { findNode, loadQuotes, neighbours, nodeParams, nodePath } from "@/lib/atlasData";
import type { GraphNode } from "@/lib/graph";
import { DICTIONARIES, type Locale } from "@/lib/i18n";
import { SITE_COPY, SITE_NAME } from "@/lib/site";

// One page per node, in plain HTML: what the canvas draws, readable by
// search engines and shareable as a link. app/(it)/[group]/[slug] and
// app/(en)/en/[group]/[slug] are thin wrappers around these.

type Params = Promise<{ group: string; slug: string }>;

const OTHER: Record<Locale, Locale> = { it: "en", en: "it" };

const MUTED = "text-[color-mix(in_oklch,var(--atlas-ink)_68%,transparent)]";

/** First sentence-ish of the node's text, cut to a search-snippet length. */
function summary(node: GraphNode, linkCount: number, locale: Locale): string {
  const text = node.description || node.blurb || node.bio || DICTIONARIES[locale].fallbackDescription(linkCount);
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 160 ? flat : `${flat.slice(0, 157).replace(/\s+\S*$/, "")}…`;
}

export const staticParams = (locale: Locale) => () => nodeParams(locale);

export const metadataFor =
  (locale: Locale) =>
  async ({ params }: { params: Params }): Promise<Metadata> => {
    const { group, slug } = await params;
    const found = findNode(locale, group, slug);
    if (!found) return {};
    const { graph, node } = found;
    const t = DICTIONARIES[locale];
    const linkCount = neighbours(graph, node).reduce((sum, block) => sum + block.nodes.length, 0);
    return pageMetadata(locale, {
      paths: { [locale]: nodePath(node, locale), [OTHER[locale]]: nodePath(node, OTHER[locale]) } as Record<
        Locale,
        string
      >,
      title: `${t.nodePageTitle(node.label, t.group[node.group])} — ${SITE_NAME}`,
      description: summary(node, linkCount, locale),
      image: node.cover ? { url: node.cover, alt: t.coverOf(node.group === "album" ? node.label : node.album) } : undefined,
    });
  };

export default async function NodePage({ locale, params }: { locale: Locale; params: Params }) {
  const { group, slug } = await params;
  const found = findNode(locale, group, slug);
  if (!found) notFound();
  const { graph, node } = found;
  const t = DICTIONARIES[locale];
  const home = SITE_COPY[locale].path;
  const blocks = neighbours(graph, node);
  const quotes = loadQuotes(node);
  const byId = new Map(graph.nodes.map((each) => [each.id, each]));
  const albumNode = node.album
    ? graph.nodes.find((each) => each.group === "album" && each.label === node.album)
    : undefined;
  const text = node.blurb || node.bio || node.description;
  // English pages keep some Italian text (no English Wikipedia page): mark it
  const textIsItalian =
    (node.bio && !node.blurb && node.italian?.includes("bio")) ||
    (!node.blurb && !node.bio && node.italian?.includes("description"));
  const aboutLang = node.italian?.includes("about") ? "it" : undefined;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-14">
      <nav className={`flex items-center justify-between font-mono text-[0.7rem] uppercase tracking-[0.16em] ${MUTED}`}>
        <Link href={home} className="hover:text-[var(--atlas-ink)]">
          ← {SITE_NAME}
        </Link>
        <Link
          href={nodePath(node, OTHER[locale])}
          hrefLang={OTHER[locale]}
          title={t.otherLanguage.title}
          className="hover:text-[var(--atlas-ink)]"
        >
          {t.otherLanguage.label}
        </Link>
      </nav>

      <article className="mt-10">
        <p className={`inline-flex items-center gap-2 text-[0.64rem] font-bold uppercase tracking-[0.18em] ${MUTED}`}>
          <GroupGlyph group={node.group} size={11} />
          {t.group[node.group]}
        </p>
        <h1 className="mt-4 text-4xl font-bold leading-[0.98] tracking-[-0.035em] text-balance sm:text-5xl">
          {node.label}
        </h1>

        {node.cover && (
          // eslint-disable-next-line @next/next/no-img-element -- third-party artwork, loaded from its source, never proxied or stored
          <img
            src={node.cover}
            alt={t.coverOf(node.group === "album" ? node.label : node.album)}
            width={160}
            height={160}
            referrerPolicy="no-referrer"
            className="mt-8 h-40 w-40 rounded-sm object-cover"
          />
        )}

        {(node.album || node.release) && (
          <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {node.album && (
              <>
                <dt className={MUTED}>{t.albumField}</dt>
                <dd>{albumNode ? <Link href={nodePath(albumNode, locale)} className="underline">{node.album}</Link> : node.album}</dd>
              </>
            )}
            {node.release && (
              <>
                <dt className={MUTED}>{t.releaseField}</dt>
                <dd>{node.release}</dd>
              </>
            )}
          </dl>
        )}

        {text && (
          <p lang={textIsItalian ? "it" : undefined} className="mt-6 text-lg leading-relaxed">
            {text}
          </p>
        )}

        {node.about?.map((section) => (
          <section key={section.heading} lang={aboutLang} className="mt-8">
            <h2 className="text-xl font-semibold tracking-[-0.02em]">{section.heading}</h2>
            {section.text.split("\n").map((paragraph, i) => (
              <p key={i} className="mt-3 leading-relaxed">
                {paragraph}
              </p>
            ))}
          </section>
        ))}

        <p className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link
            href={`${home}?node=${encodeURIComponent(node.id)}`}
            className="rounded-full border border-[var(--atlas-ink)] px-4 py-1.5 font-semibold"
          >
            {t.openInAtlas} →
          </Link>
          {node.url && (
            <a href={node.url} rel="noopener" className="self-center underline">
              {t.openOnGenius}
            </a>
          )}
          {node.youtube && (
            <a
              href={`https://www.youtube.com/watch?v=${node.youtube.id}`}
              rel="noopener"
              className="self-center underline"
            >
              YouTube · {t.youtubeKind[node.youtube.kind]}
            </a>
          )}
        </p>

        {node.tracks && node.tracks.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-semibold tracking-[-0.02em]">{t.tracks}</h2>
            <ol className="mt-3 list-decimal space-y-1 pl-6">
              {node.tracks.map((track, i) => {
                const song = track.id ? byId.get(track.id) : undefined;
                return (
                  <li key={`${i}-${track.label}`}>
                    {song ? (
                      <Link href={nodePath(song, locale)} className="underline">
                        {track.label}
                      </Link>
                    ) : (
                      track.label
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {quotes.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-semibold tracking-[-0.02em]">{t.annotatedQuotes}</h2>
            {t.quotesNote && <p className={`mt-2 text-sm ${MUTED}`}>{t.quotesNote}</p>}
            <ul className="mt-4 space-y-6">
              {quotes.map((quote, i) => (
                <li key={i} lang="it">
                  <blockquote className="border-l-2 border-[var(--atlas-ink)] pl-3 font-semibold italic">
                    {quote.fragment}
                  </blockquote>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{quote.annotation.trim()}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {blocks.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-semibold tracking-[-0.02em]">{t.linkedTo}</h2>
            {blocks.map((block) => (
              <div key={block.group} className="mt-5">
                <h3 className={`inline-flex items-center gap-2 text-[0.64rem] font-bold uppercase tracking-[0.18em] ${MUTED}`}>
                  <GroupGlyph group={block.group} size={10} />
                  {t.groupPlural[block.group]}
                </h3>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {block.nodes.map((other) => (
                    <li key={other.id}>
                      <Link href={nodePath(other, locale)} className="underline">
                        {other.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}
      </article>

      <footer className={`mt-16 border-t border-[var(--atlas-hair)] pt-4 text-xs ${MUTED}`}>
        {t.unofficial}
      </footer>
    </main>
  );
}
