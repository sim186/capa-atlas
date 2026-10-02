import type { NextConfig } from "next";

// GitHub Pages hosts project sites under /<repo>/, so asset and route paths
// need a base path there. Local development stays at the root.
const isGhPages = process.env.GH_PAGES === "true";

const BASE_PATH = isGhPages ? "/capa-atlas" : "";

const nextConfig: NextConfig = {
  // Plain <img src> and fetch() of files in public/ are not rewritten by Next,
  // so the client needs the base path to build those URLs itself (lib/basePath.ts).
  env: { NEXT_PUBLIC_BASE_PATH: BASE_PATH },
  // Lets a phone on the local network load the dev server (hydration and HMR
  // are blocked from non-localhost origins otherwise).
  allowedDevOrigins: ["192.168.1.158"],
  // Static export: the whole site is prerendered to `out/` and served as-is.
  // This rules out server features (rewrites, route handlers) — PostHog
  // therefore talks directly to us.i.posthog.com, see instrumentation-client.ts.
  output: "export",
  ...(isGhPages ? { basePath: BASE_PATH, assetPrefix: `${BASE_PATH}/` } : {}),
};

export default nextConfig;
