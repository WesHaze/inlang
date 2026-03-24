import { context } from "esbuild"

const isProduction = process.env.NODE_ENV === "production"

const ctx = await context({
  entryPoints: ["./src/scan.ts", "./src/validate.ts", "./src/write.ts"],
  bundle: true,
  outdir: "./dist",
  platform: "node",
  format: "esm",
  target: "node18",
  minify: false,
  banner: {
    js: `
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);
import pathPolyfill from "node:path"
import { fileURLToPath as fileURLToPathPolyfill } from "node:url"
const __filename = fileURLToPathPolyfill(import.meta.url)
const __dirname = pathPolyfill.dirname(__filename)
`,
  },
})

if (isProduction) {
  await ctx.rebuild()
  await ctx.dispose()
} else {
  await ctx.watch()
  console.info("Watching for changes...")
}
