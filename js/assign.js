// Balanced condition assignment for between-subject experiments (engine B).
// Plan: alternate conditions over a random order instead of drawing each person independently,
// so group sizes differ by at most one; every experiment is split independently of the others.

export function shuffle(items, rnd = Math.random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Everyone present when the batch opens. The starting label is random too, so with an odd
// number of people the extra person is not always in the first condition.
export function balancedAssign(uids, labels, rnd = Math.random) {
  const order = shuffle(uids, rnd);
  const offset = Math.floor(rnd() * labels.length);
  const byUid = {};
  order.forEach((u, i) => { byUid[u] = labels[(i + offset) % labels.length]; });
  return byUid;
}

// A person who joins after the batch opened: the condition with the fewest people so far
// (random among ties), which keeps the groups within one person of each other.
export function leastUsed(byUid, labels, rnd = Math.random) {
  const counts = Object.fromEntries(labels.map((l) => [l, 0]));
  for (const l of Object.values(byUid || {})) if (l in counts) counts[l]++;
  const min = Math.min(...Object.values(counts));
  const tied = labels.filter((l) => counts[l] === min);
  return tied[Math.floor(rnd() * tied.length)];
}

export function groupCounts(byUid, labels) {
  const counts = Object.fromEntries(labels.map((l) => [l, 0]));
  for (const l of Object.values(byUid || {})) if (l in counts) counts[l]++;
  return counts;
}
