import esbuild from "esbuild";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, "dist");
const prod = process.argv[2] === "production";

mkdirSync(distDir, { recursive: true });

const copyAssets = {
  name: "copy-plugin-assets",
  setup(build) {
    build.onEnd(() => {
      copyFileSync(resolve(here, "manifest.json"), resolve(distDir, "manifest.json"));
      const styles = resolve(here, "styles.css");
      if (existsSync(styles)) copyFileSync(styles, resolve(distDir, "styles.css"));
    });
  },
};

const context = await esbuild.context({
  entryPoints: [resolve(here, "src/main.ts")],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2022",
  platform: "node",
  outfile: resolve(distDir, "main.js"),
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  logLevel: "info",
  plugins: [copyAssets],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
