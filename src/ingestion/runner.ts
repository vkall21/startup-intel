import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { runTechCrunchIngestion } from "./techcrunch";
import { runProductHuntIngestion } from "./producthunt";

type Source = "techcrunch" | "producthunt" | "all";

async function runIngestion(source: Source): Promise<void> {
  console.log(`\n=== Ingestion Runner — ${source} ===`);
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const start = Date.now();

  try {
    if (source === "techcrunch" || source === "all") {
      await runTechCrunchIngestion();
    }
    if (source === "producthunt" || source === "all") {
      await runProductHuntIngestion();
    }
  } catch (err) {
    console.error("Ingestion failed:", err);
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n=== Ingestion complete in ${elapsed}s ===`);
}

const arg = (process.argv[2] || "all") as Source;
if (!["techcrunch", "producthunt", "all"].includes(arg)) {
  console.error("Usage: ts-node src/ingestion/runner.ts [techcrunch|producthunt|all]");
  process.exit(1);
}

runIngestion(arg).catch(console.error);
