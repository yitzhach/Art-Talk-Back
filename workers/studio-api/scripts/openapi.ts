// Writes docs/openapi.json from the code (the spec's "generated openapi.json").
import { writeFileSync } from "node:fs";
import { openApiDocument } from "../src/index";

const doc = openApiDocument();
writeFileSync(new URL("../../../docs/openapi.json", import.meta.url), `${JSON.stringify(doc, null, 2)}\n`);
console.log(`docs/openapi.json: ${Object.keys(doc.paths ?? {}).length} paths`);
