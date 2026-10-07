import posthog from "posthog-js";

// PostHog client-side initialization for Next.js App Router.
// This file runs before React hydration. Static export (GitHub Pages) has no
// server, so events go straight to the PostHog ingestion host instead of the
// /ingest reverse proxy. Ad-blockers may drop some traffic; that is the known
// trade-off of hosting without a server.

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

if (!token) {
  if (process.env.NODE_ENV !== "production") {
    // Fail loudly in development so missing analytics is never silent.
    throw new Error(
      "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, " +
        "this causes events to be silently missed. This error stops appearing once " +
        "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured"
    );
  }
  // In production without a token: no-op, the app keeps working.
} else {
  posthog.init(token, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
    ui_host: "https://eu.posthog.com",
    defaults: "2026-05-30",
    // Error tracking: capture unhandled exceptions.
    capture_exceptions: true,
    // Web analytics: Core Web Vitals and performance timing.
    capture_performance: true,
    debug: process.env.NODE_ENV === "development",
  });
}

// Capture a $pageview on client-side App Router navigations.
// The initial pageview is captured automatically by posthog-js.
export function onRouterTransitionStart(
  url: string,
  navigationType: "push" | "replace" | "traverse"
) {
  if (navigationType === "traverse") return;
  if (!token) return;
  posthog.capture("$pageview", { $current_url: url });
}
