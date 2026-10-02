/**
 * Prefix for URLs of files in public/ that Next does not rewrite (plain
 * <img src>, fetch()). Empty locally, "/capa-atlas" on GitHub Pages — see
 * next.config.ts.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
