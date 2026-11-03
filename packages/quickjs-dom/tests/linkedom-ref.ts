import { readFileSync } from "node:fs";
import type { QuickJSDOM } from "../src/index.js";

/** Put linkedom (the reference the native DOM is compared with) into a page as `__linkedom`; built by scripts/build-edge-js.mjs. */
export async function loadLinkedomRef(dom: QuickJSDOM): Promise<void> {
  const source = readFileSync(new URL("../.test-gen/linkedom-ref.js", import.meta.url), "utf8");
  await dom.eval(source);
}
