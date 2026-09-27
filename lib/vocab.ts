import raw from "@/data/vocab.json";

/** Sentinel emitted when the model decides the reply is finished. */
export const END = "<END>";

/** Jev's Choice questions accept at most this many options. */
export const MAX_CHOICE_OPTIONS = 255;

export interface VocabGroup {
  id: string;
  description: string;
  words: string[];
  /** Optional per-word descriptions sent to Jev as criteria text (used for punctuation). */
  descriptions: Record<string, string>;
}

export interface Vocab {
  groups: VocabGroup[];
  /** Every distinct word across all groups (excluding END). */
  words: string[];
  wordSet: Set<string>;
}

interface RawGroup {
  id: string;
  description: string;
  words: string;
  descriptions?: Record<string, string>;
}

export function parseVocab(data: { groups: RawGroup[] }): Vocab {
  const groups = data.groups.map((g) => ({
    id: g.id,
    description: g.description,
    words: g.words.split(/\s+/).filter(Boolean),
    descriptions: g.descriptions ?? {},
  }));
  validateVocab(groups);
  const wordSet = new Set(groups.flatMap((g) => g.words));
  return { groups, words: [...wordSet], wordSet };
}

/** Throws if any group would be rejected by Jev or is internally inconsistent. */
export function validateVocab(groups: VocabGroup[]): void {
  const ids = new Set<string>();
  // The top-level "which group?" question has one option per group plus END.
  if (groups.length + 1 > MAX_CHOICE_OPTIONS) {
    throw new Error(`Too many vocabulary groups: ${groups.length}`);
  }
  for (const g of groups) {
    if (!/^[a-z][a-z0-9_]*$/.test(g.id)) throw new Error(`Invalid group id "${g.id}"`);
    if (ids.has(g.id)) throw new Error(`Duplicate group id "${g.id}"`);
    ids.add(g.id);
    if (g.words.length < 2) throw new Error(`Group "${g.id}" needs at least 2 words`);
    if (g.words.length > MAX_CHOICE_OPTIONS) {
      throw new Error(`Group "${g.id}" has ${g.words.length} words (max ${MAX_CHOICE_OPTIONS})`);
    }
    const seen = new Set<string>();
    for (const w of g.words) {
      if (w === END) throw new Error(`Group "${g.id}" contains the reserved token ${END}`);
      if (seen.has(w)) throw new Error(`Group "${g.id}" contains "${w}" twice`);
      seen.add(w);
    }
  }
}

export const vocab: Vocab = parseVocab(raw as { groups: RawGroup[] });
