/**
 * Phase 4b — Background AI edges.
 *
 * Adds two edge kinds to the connection graph that the deterministic
 * write-time extractors (Phase 4a) miss:
 *
 *   - `keyword_overlap` — entities whose extracted-keyword sets have
 *     significant Jaccard overlap. Surfaces topical relationships that
 *     don't share an explicit `[[wikilink]]`.
 *   - `co_mention` — entities (people / clients / companies) that
 *     get mentioned together in third-party docs (meeting notes, daily
 *     notes, etc.). Surfaces relationships from "Matt + Trade Oracle
 *     came up in 5 different meetings."
 *
 * Both are deterministic + cheap. The third planned kind from the
 * Phase 4b spec — `ai_suggested` — is deferred to v2 because it
 * requires an LLM cost budget; the schema field is already in place.
 *
 * Both functions are idempotent: they delete existing edges of their
 * kind for the entities they touch, then re-insert. Safe to re-run
 * any time. The cron route at /api/cron/connections runs them on a
 * schedule.
 */

import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  backlinks,
  items,
  projects,
  spaces,
  wikiPages,
} from "@/lib/db/schema";

/** Stop-words excluded from keyword extraction. Short, English, lower-case. */
const STOP_WORDS = new Set<string>([
  "a", "about", "after", "again", "all", "also", "am", "an", "and", "any",
  "are", "as", "at", "be", "because", "been", "before", "being", "below",
  "between", "both", "but", "by", "can", "could", "did", "do", "does",
  "doing", "down", "during", "each", "for", "from", "further", "had", "has",
  "have", "having", "he", "her", "here", "hers", "herself", "him", "himself",
  "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just",
  "like", "me", "more", "most", "my", "myself", "no", "nor", "not", "now",
  "of", "off", "on", "once", "only", "or", "other", "our", "ours", "out",
  "over", "own", "same", "she", "should", "so", "some", "such", "than",
  "that", "the", "their", "theirs", "them", "themselves", "then", "there",
  "these", "they", "this", "those", "through", "to", "too", "under", "until",
  "up", "us", "very", "was", "we", "were", "what", "when", "where", "which",
  "while", "who", "whom", "why", "will", "with", "would", "you", "your",
  "yours", "yourself", "yourselves",
  // Vault-domain noise we don't want as keywords
  "task", "tasks", "meeting", "notes", "note", "doc", "docs", "page",
]);

/**
 * Tokenize text into a multiset of keywords. Returns top-N by count.
 * Cheap O(n) over content; designed to run over thousands of entities
 * within a single cron tick.
 */
function extractKeywords(text: string, limit = 30): Set<string> {
  if (!text) return new Set();
  // Lowercase, replace non-letters with spaces, split.
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));

  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);

  // Top-N by frequency. Below the limit: keep all. Above: take top.
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return new Set(sorted.slice(0, limit).map(([k]) => k));
}

function jaccard(a: Set<string>, b: Set<string>): { score: number; intersection: string[] } {
  if (a.size === 0 || b.size === 0) return { score: 0, intersection: [] };
  const intersection: string[] = [];
  for (const k of a) if (b.has(k)) intersection.push(k);
  if (intersection.length === 0) return { score: 0, intersection: [] };
  const union = new Set([...a, ...b]);
  return { score: intersection.length / union.size, intersection };
}

type KeywordEntity = {
  type: "wiki_page" | "item";
  id: string;
  title: string;
  keywords: Set<string>;
};

/**
 * Compute keyword_overlap edges across all wiki_pages + items in the
 * org. For each pair with Jaccard >= MIN_JACCARD AND >= MIN_SHARED
 * shared keywords, write a backlink with kind='keyword_overlap',
 * score=Jaccard, evidence={shared_keywords: [top 5]}.
 *
 * Two-pass:
 *   1. Pull all entities + extract keywords (in-memory).
 *   2. For each entity, find candidates with >=1 shared keyword via
 *      an inverted index, score those, write top-K edges.
 *
 * Idempotent: deletes all keyword_overlap edges where source OR target
 * is in the processed set, then re-inserts.
 */
export async function computeKeywordOverlap(args: {
  orgId: string;
  /** Min Jaccard score to keep an edge. Default 0.15 (modestly related). */
  minJaccard?: number;
  /** Min shared-keyword count. Default 5. */
  minShared?: number;
  /** Max edges per entity (top-K). Default 8. */
  perEntityCap?: number;
}): Promise<{ entities: number; edges: number }> {
  const minJaccard = args.minJaccard ?? 0.15;
  const minShared = args.minShared ?? 5;
  const perEntityCap = args.perEntityCap ?? 8;

  // 1. Pull entities + extract keywords.
  const wikiRows = await db
    .select({
      id: wikiPages.id,
      title: wikiPages.title,
      content: wikiPages.content,
      extractedText: wikiPages.extractedText,
    })
    .from(wikiPages)
    .where(eq(wikiPages.orgId, args.orgId));

  const itemRows = await db
    .select({ id: items.id, title: items.title, content: items.content })
    .from(items)
    .innerJoin(projects, eq(items.projectId, projects.id))
    .innerJoin(spaces, eq(projects.spaceId, spaces.id))
    .where(eq(spaces.orgId, args.orgId));

  const entities: KeywordEntity[] = [];
  for (const w of wikiRows) {
    const text = `${w.title}\n${w.content ?? ""}\n${w.extractedText ?? ""}`;
    entities.push({ type: "wiki_page", id: w.id, title: w.title, keywords: extractKeywords(text) });
  }
  for (const i of itemRows) {
    const text = `${i.title}\n${i.content ?? ""}`;
    entities.push({ type: "item", id: i.id, title: i.title, keywords: extractKeywords(text) });
  }

  // 2. Inverted index: keyword → list of entity indices.
  const inverted = new Map<string, number[]>();
  entities.forEach((e, idx) => {
    for (const kw of e.keywords) {
      const list = inverted.get(kw) ?? [];
      list.push(idx);
      inverted.set(kw, list);
    }
  });

  // 3. For each entity, score candidates and pick top-K.
  type Edge = {
    sourceType: "wiki_page" | "item";
    sourceId: string;
    targetType: "wiki_page" | "item";
    targetId: string;
    kind: "keyword_overlap";
    score: number;
    evidence: { shared_keywords: string[] };
  };
  const edges: Edge[] = [];

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e.keywords.size === 0) continue;
    // Collect candidates: any entity sharing at least one keyword.
    const candidateIndices = new Set<number>();
    for (const kw of e.keywords) {
      for (const idx of inverted.get(kw) ?? []) {
        if (idx !== i) candidateIndices.add(idx);
      }
    }
    // Score each candidate.
    const scored: Array<{ idx: number; score: number; intersection: string[] }> = [];
    for (const cIdx of candidateIndices) {
      const c = entities[cIdx];
      const { score, intersection } = jaccard(e.keywords, c.keywords);
      if (score >= minJaccard && intersection.length >= minShared) {
        scored.push({ idx: cIdx, score, intersection });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    for (const s of scored.slice(0, perEntityCap)) {
      const c = entities[s.idx];
      // Write a single direction (source < target by id) to dedupe pairs.
      const a = e.id < c.id ? e : c;
      const b = e.id < c.id ? c : e;
      edges.push({
        sourceType: a.type,
        sourceId: a.id,
        targetType: b.type,
        targetId: b.id,
        kind: "keyword_overlap",
        score: s.score,
        evidence: { shared_keywords: s.intersection.slice(0, 5) },
      });
    }
  }

  // De-duplicate the edges array (we may have added both directions
  // before the source<target normalization in some edge cases).
  const seen = new Set<string>();
  const dedupedEdges = edges.filter((edge) => {
    const key = `${edge.sourceType}:${edge.sourceId}|${edge.targetType}:${edge.targetId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 4. Replace existing keyword_overlap edges for these entities.
  const entityIds = entities.map((e) => e.id);
  if (entityIds.length > 0) {
    await db
      .delete(backlinks)
      .where(
        and(
          eq(backlinks.kind, "keyword_overlap"),
          or(
            inArray(backlinks.sourceId, entityIds),
            inArray(backlinks.targetId, entityIds),
          ),
        ),
      );
  }

  if (dedupedEdges.length > 0) {
    // Insert in chunks of 500 to keep the SQL statement small.
    const CHUNK = 500;
    for (let i = 0; i < dedupedEdges.length; i += CHUNK) {
      await db.insert(backlinks).values(dedupedEdges.slice(i, i + CHUNK));
    }
  }

  return { entities: entities.length, edges: dedupedEdges.length };
}

/**
 * Compute co_mention edges. Two "person/company/client" entities are
 * co-mentioned when both appear (by [[wikilink]] or by title-text
 * match) in the same third-party document (meeting note, daily note,
 * email draft, etc.).
 *
 * For Phase 4b v1 we identify "people-or-companies" by their wiki
 * page's filePath: anything under `Pipeline/`, `Partners/`,
 * `Clients/<NAME>/_Overview.md`, `SimHouse.io/Clients/`, or
 * `Coaching/Clients/`.
 *
 * Idempotent: replaces existing co_mention edges for the processed set.
 */
export async function computeCoMentions(args: {
  orgId: string;
  perEntityCap?: number;
}): Promise<{ people: number; documents: number; edges: number }> {
  const perEntityCap = args.perEntityCap ?? 10;

  // 1. Pull all wiki pages with their filePath metadata.
  const allPages = await db
    .select({
      id: wikiPages.id,
      title: wikiPages.title,
      content: wikiPages.content,
      metadata: wikiPages.metadata,
    })
    .from(wikiPages)
    .where(eq(wikiPages.orgId, args.orgId));

  // 2. Identify "people/company" pages by filePath rules.
  const personPagePathPrefixes = [
    "Pipeline/",
    "Partners/",
    "SimHouse.io/Clients/",
    "Coaching/Clients/",
  ];
  type PersonPage = { id: string; title: string };
  const personPages: PersonPage[] = [];

  for (const p of allPages) {
    const filePath =
      (p.metadata as { filePath?: string } | null)?.filePath ?? "";
    const isPerson =
      personPagePathPrefixes.some((pre) => filePath.startsWith(pre)) ||
      // Client _Overview.md → treat the company as a person-equivalent
      /^Clients\/[^/]+\/_Overview\.md$/.test(filePath);
    if (isPerson) personPages.push({ id: p.id, title: p.title });
  }

  // 3. For each non-person page, find which person pages it mentions.
  // Mention detection: case-insensitive substring match of the person's
  // title in the page content. Cheap and good enough for v1.
  const lowerTitleById = new Map(
    personPages.map((p) => [p.id, p.title.toLowerCase()]),
  );
  const personIdsByTitleLower = new Map<string, string>();
  for (const p of personPages) {
    personIdsByTitleLower.set(p.title.toLowerCase(), p.id);
  }
  const personIds = new Set(personPages.map((p) => p.id));

  // For each document, collect set of person IDs mentioned.
  type DocMentions = { docId: string; docTitle: string; personIds: Set<string> };
  const docMentions: DocMentions[] = [];

  for (const p of allPages) {
    if (personIds.has(p.id)) continue; // skip person pages themselves
    const body = (p.content ?? "").toLowerCase();
    if (!body) continue;
    const mentioned = new Set<string>();
    // Match each person's title as a substring. O(personPages * pages).
    // For ~1k people * ~5k pages = 5M ops, fine.
    for (const [pid, lowerTitle] of lowerTitleById) {
      if (lowerTitle.length < 3) continue;
      if (body.includes(lowerTitle)) mentioned.add(pid);
    }
    if (mentioned.size >= 2) {
      docMentions.push({ docId: p.id, docTitle: p.title, personIds: mentioned });
    }
  }

  // 4. From doc-level mentions, derive pairwise person co-mentions.
  // Track which docs evidenced each pair.
  type PairKey = string; // `${aId}|${bId}` with aId < bId
  type PairEvidence = { aId: string; bId: string; docs: Array<{ id: string; title: string }>; };
  const pairs = new Map<PairKey, PairEvidence>();

  for (const d of docMentions) {
    const ids = [...d.personIds];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i] < ids[j] ? ids[i] : ids[j];
        const b = ids[i] < ids[j] ? ids[j] : ids[i];
        const key: PairKey = `${a}|${b}`;
        const existing = pairs.get(key);
        if (existing) {
          if (existing.docs.length < 5) {
            existing.docs.push({ id: d.docId, title: d.docTitle });
          }
        } else {
          pairs.set(key, {
            aId: a,
            bId: b,
            docs: [{ id: d.docId, title: d.docTitle }],
          });
        }
      }
    }
  }

  // 5. Per-entity cap: limit edges to top-K per person by co-mention count.
  // Build adjacency: entity → list of (otherId, docCount, evidence).
  type Adj = Array<{ otherId: string; count: number; evidence: PairEvidence }>;
  const adj = new Map<string, Adj>();
  for (const ev of pairs.values()) {
    const aList = adj.get(ev.aId) ?? [];
    aList.push({ otherId: ev.bId, count: ev.docs.length, evidence: ev });
    adj.set(ev.aId, aList);
    const bList = adj.get(ev.bId) ?? [];
    bList.push({ otherId: ev.aId, count: ev.docs.length, evidence: ev });
    adj.set(ev.bId, bList);
  }
  for (const [, list] of adj) list.sort((x, y) => y.count - x.count);

  const keptKeys = new Set<PairKey>();
  for (const [pid, list] of adj) {
    for (const e of list.slice(0, perEntityCap)) {
      const a = pid < e.otherId ? pid : e.otherId;
      const b = pid < e.otherId ? e.otherId : pid;
      keptKeys.add(`${a}|${b}` as PairKey);
    }
  }

  // 6. Build edge rows.
  type Edge = {
    sourceType: "wiki_page";
    sourceId: string;
    targetType: "wiki_page";
    targetId: string;
    kind: "co_mention";
    score: number;
    evidence: { docs: Array<{ id: string; title: string }>; doc_count: number };
  };
  const edges: Edge[] = [];
  for (const key of keptKeys) {
    const ev = pairs.get(key)!;
    edges.push({
      sourceType: "wiki_page",
      sourceId: ev.aId,
      targetType: "wiki_page",
      targetId: ev.bId,
      kind: "co_mention",
      // Score: 1 - (1 / (1 + doc_count)). 1 doc = 0.5, 5 docs = 0.83, ∞ → 1.
      score: 1 - 1 / (1 + ev.docs.length),
      evidence: { docs: ev.docs, doc_count: ev.docs.length },
    });
  }

  // 7. Replace existing co_mention edges for these entities.
  const personIdList = personPages.map((p) => p.id);
  if (personIdList.length > 0) {
    await db
      .delete(backlinks)
      .where(
        and(
          eq(backlinks.kind, "co_mention"),
          or(
            inArray(backlinks.sourceId, personIdList),
            inArray(backlinks.targetId, personIdList),
          ),
        ),
      );
  }

  if (edges.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < edges.length; i += CHUNK) {
      await db.insert(backlinks).values(edges.slice(i, i + CHUNK));
    }
  }

  return {
    people: personPages.length,
    documents: docMentions.length,
    edges: edges.length,
  };
}

/**
 * Run all background-edge computations for an org. This is what the
 * cron route calls.
 */
export async function runBackgroundEdges(orgId: string): Promise<{
  keyword_overlap: { entities: number; edges: number };
  co_mention: { people: number; documents: number; edges: number };
  duration_ms: number;
}> {
  const start = Date.now();
  const keyword_overlap = await computeKeywordOverlap({ orgId });
  const co_mention = await computeCoMentions({ orgId });
  return {
    keyword_overlap,
    co_mention,
    duration_ms: Date.now() - start,
  };
}
