/** Demo customers with a bundled Unsplash portrait in public/avatars (sources: CREDITS.md). */
const AVATAR_IDS_BY_NAME: Record<string, string> = {
  "Emma Carter": "cust_001",
  "Noah Kim": "cust_002",
  "Sofia Rossi": "cust_003",
  "Liam Novak": "cust_004",
  "Ava Lindqvist": "cust_005",
  "Oliver Grant": "cust_006",
  "Marcus Webb": "cust_007",
};

const AVATAR_IDS = new Set(Object.values(AVATAR_IDS_BY_NAME));

export const SUPPORT_AVATAR_SRC = "/avatars/support.jpg";

/** The case list only carries a name, so the id wins when given and the name is the fallback. */
export function avatarSrc(person: {
  id?: string;
  name: string;
}): string | null {
  const id =
    person.id !== undefined && AVATAR_IDS.has(person.id)
      ? person.id
      : AVATAR_IDS_BY_NAME[person.name.trim()];
  return id ? `/avatars/${id}.jpg` : null;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts.at(-1)] : parts;
  return letters.map((p) => p?.[0]?.toUpperCase() ?? "").join("") || "?";
}
