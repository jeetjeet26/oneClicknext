import type { NextConfig } from "next";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";
import { withWorkflow } from "workflow/next";

/**
 * Load environment variables early so they're available to:
 * - Next.js build/dev process
 * - Edge middleware bundling (Turbopack can otherwise miss monorepo env)
 *
 * Priority (first match wins for a given key, per dotenv behavior):
 * 1) apps/web/.env.local
 * 2) apps/web/.env
 * 3) p11-platform/.env.local
 * 4) p11-platform/.env
 */
const envPaths = [
  resolve(__dirname, ".env.local"),
  resolve(__dirname, ".env"),
  resolve(__dirname, "../../.env.local"),
  resolve(__dirname, "../../.env"),
];

for (const p of envPaths) {
  if (existsSync(p)) loadDotenv({ path: p });
}

const publicSupabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

if (publicSupabaseKey === "[SENSITIVE]") {
  throw new Error(
    "Refusing to build with Vercel's [SENSITIVE] placeholder as the public Supabase key. Use a remote build or inject the verified publishable key.",
  );
}

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["127.0.0.1"],
  reactCompiler: true,
  serverExternalPackages: [
    "ssh2",
    "@browserbasehq/sdk",
    "playwright-core",
    "axe-core",
  ],
  outputFileTracingIncludes: {
    "/.well-known/workflow/v1/step": ["./runtime-assets/*"],
    "/api/siteforge/browser-certifier": [
      "./node_modules/playwright-core/**/*",
      "./node_modules/axe-core/**/*",
    ],
  },
  /**
   * Ensure Edge middleware has access to required public env vars in dev/prod.
   * (This does not expose anything that isn't already NEXT_PUBLIC_*)
   */
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicSupabaseKey,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? "",
  },
  turbopack: {
    root: __dirname,
  },
};

export default withWorkflow(nextConfig);
