import { context } from "esbuild"
import { copyFile, cp, mkdir, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const isProduction = process.env.NODE_ENV === "production"
const outSkillDir = join(__dirname, "dist/inlang-translate")
const outScriptsDir = join(outSkillDir, "scripts")

if (isProduction) {
  await rm(join(__dirname, "dist"), { recursive: true, force: true })
}

const ctx = await context({
  entryPoints: [
    join(__dirname, "src/scan.ts"),
    join(__dirname, "src/validate.ts"),
    join(__dirname, "src/write.ts"),
  ],
  bundle: true,
  outdir: outScriptsDir,
  platform: "node",
  format: "esm",
  target: "node18",
  minify: false,
  // https://github.com/evanw/esbuild/issues/1921#issuecomment-1403107887
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

async function copyAssets() {
  await mkdir(join(outSkillDir, "references"), { recursive: true })
  await copyFile(join(__dirname, "SKILL.md"), join(outSkillDir, "SKILL.md"))
  await copyFile(join(__dirname, "config.json"), join(outSkillDir, "config.json"))
  await cp(join(__dirname, "references"), join(outSkillDir, "references"), { recursive: true })
}

if (isProduction) {
  await ctx.rebuild()
  await ctx.dispose()
  await copyAssets()
} else {
  await copyAssets()
  await ctx.watch()
  console.info("Watching for changes...")
}
