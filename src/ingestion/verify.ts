import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
import { db } from "../lib/db";

(async () => {
  const { count: hiring } = await db.from("companies")
    .select("*", { count: "exact", head: true })
    .eq("source", "yc").eq("is_hiring", true);
  const { count: notHiring } = await db.from("companies")
    .select("*", { count: "exact", head: true })
    .eq("source", "yc").eq("is_hiring", false);
  const { count: nullHiring } = await db.from("companies")
    .select("*", { count: "exact", head: true })
    .eq("source", "yc").is("is_hiring", null);

  console.log("YC is_hiring breakdown:");
  console.log(`  is_hiring=true:  ${hiring}`);
  console.log(`  is_hiring=false: ${notHiring}`);
  console.log(`  is_hiring=NULL:  ${nullHiring}`);
})();
