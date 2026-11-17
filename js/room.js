// Room codes: 6 characters, no look-alike characters (I, O, 0, 1 removed).
// Must stay in sync with the regex in firestore.rules.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 symbols, so byte % 32 is uniform
export const ROOM_RE = /^[A-HJ-NP-Z2-9]{6}$/;

export function newRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join("");
}

export function normalizeRoomCode(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

// Response document id: one document per person per experiment.
export function responseId(uid, expId) {
  return `${uid}_${expId}`;
}
