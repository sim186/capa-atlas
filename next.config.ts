import type { NextConfig } from "next";

// GitHub Pages hosts project sites under /<repo>/, so asset and route paths
// need a base path there. Local development stays at the root.
const isGhPages = process.env.GH_PAGES === "true";

const nextConfig: NextConfig = {
  // Lets a phone on the local network load the dev server (hydration and HMR
  // are blocked from non-localhost origins otherwise).
  allowedDevOrigins: ["192.168.1.158"],
  // Static export: the whole site is prerendered to `out/` and served as-is.
  // This rules out server features (rewrites, route handlers) — PostHog
  // therefore talks directly to us.i.posthog.com, see instrumentation-client.ts.
  output: "export",
  ...(isGhPages ? { basePath: "/capa-atlas", assetPrefix: "/capa-atlas/" } : {}),
};

export default nextConfig;
