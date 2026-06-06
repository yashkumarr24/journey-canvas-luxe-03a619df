// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const preset = process.env.NITRO_PRESET ?? "cloudflare-module";

// Map preset → output directory so Nitro emits to the location each host expects.
const outputDirByPreset: Record<string, string> = {
  vercel: ".vercel/output",
  "vercel-edge": ".vercel/output",
  "node-server": ".output",
  netlify: ".netlify",
  "cloudflare-module": "dist",
};

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Enable Nitro explicitly so it runs outside the Lovable sandbox (e.g. on Vercel CI).
  // For preset-aware hosts (vercel, netlify, etc.) we override only `output.dir` and clear
  // serverDir/publicDir so the preset's own layout (e.g. .vercel/output/functions/...,
  // .vercel/output/static) takes effect instead of the Lovable default `dist/server` + `dist/client`.
  nitro: {
    preset,
    output: {
      dir: outputDirByPreset[preset] ?? "dist",
      serverDir: undefined as unknown as string,
      publicDir: undefined as unknown as string,
    },
  },
});
