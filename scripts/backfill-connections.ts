/**
 * One-time backfill of explicit + frontmatter connection edges for every
 * wiki page and item in every org. Safe to re-run; replaceWriteTimeEdges
 * deletes and re-inserts.
 *
 * Usage:
 *   npm run backfill:connections
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { indexEntityLinks } from "../src/lib/connections/extract";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in .env.local");
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql, { schema });

  const orgs = await db.select().from(schema.organizations);
  console.log(`Found ${orgs.length} org(s)`);

  for (const org of orgs) {
    console.log(`\nOrg: ${org.name} (${org.id})`);

    const pages = await db
      .select()
      .from(schema.wikiPages)
      .where(eq(schema.wikiPages.orgId, org.id));
    console.log(`  Wiki pages: ${pages.length}`);
    for (const p of pages) {
      const fm = (p.metadata as { frontmatter?: Record<string, unknown> } | null)?.frontmatter;
      const result = await indexEntityLinks({
        orgId: org.id,
        source: { type: "wiki_page", id: p.id },
        body: p.content,
        frontmatter: fm,
      });
      if (result.resolved + result.unresolved > 0) {
        console.log(
          `    ${p.title.slice(0, 60).padEnd(60)} resolved=${result.resolved} unresolved=${result.unresolved}`,
        );
      }
    }

    // Items — title + content body
    const itemsRows = await db
      .select({ item: schema.items })
      .from(schema.items)
      .innerJoin(schema.projects, eq(schema.items.projectId, schema.projects.id))
      .innerJoin(schema.spaces, eq(schema.projects.spaceId, schema.spaces.id))
      .where(eq(schema.spaces.orgId, org.id));
    console.log(`  Items: ${itemsRows.length}`);
    for (const { item } of itemsRows) {
      const result = await indexEntityLinks({
        orgId: org.id,
        source: { type: "item", id: item.id },
        body: `${item.title}\n\n${item.content ?? ""}`,
      });
      if (result.resolved + result.unresolved > 0) {
        console.log(
          `    ${item.title.slice(0, 60).padEnd(60)} resolved=${result.resolved} unresolved=${result.unresolved}`,
        );
      }
    }
  }

  console.log("\n✓ backfill complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
