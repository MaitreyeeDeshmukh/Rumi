// Copies the built prototype into public/preview so the site can link to a working demo.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../../../prototype/dist/index.html");
const target = resolve(here, "../public/preview/index.html");

if (!existsSync(source)) {
  console.error("Prototype build not found. Run `npm run build` in prototype/ first.");
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log("preview synced");
