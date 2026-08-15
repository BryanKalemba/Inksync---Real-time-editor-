const ADJECTIVES = ['Quiet', 'Amber', 'Swift', 'Northern', 'Curious', 'Bright', 'Steady', 'Quiet'];
const NOUNS = ['Heron', 'Fox', 'Cartographer', 'Otter', 'Scribe', 'Wren', 'Lynx', 'Editor'];

// A curated ink-palette so cursor colors always feel intentional, never
// a random RGB clash. Picked to stay legible on the paper background.
export const CURSOR_PALETTE = [
  '#C0553B', // terracotta ink
  '#3F6E5A', // bottle-green ink
  '#6B5CA5', // violet ink
  '#B98A2E', // gold-nib ink
  '#3A6E86', // slate-teal ink
  '#A8456B', // rose ink
];

function colorForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return CURSOR_PALETTE[Math.abs(hash) % CURSOR_PALETTE.length];
}

export function getUserIdentity() {
  const key = 'inksync-user-identity';
  const cached = sessionStorage.getItem(key);
  if (cached) return JSON.parse(cached);

  const name = `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]} ${
    NOUNS[Math.floor(Math.random() * NOUNS.length)]
  }`;
  const identity = { name, color: colorForName(name) };
  sessionStorage.setItem(key, JSON.stringify(identity));
  return identity;
}
