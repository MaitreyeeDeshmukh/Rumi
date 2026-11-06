/**
 * The voices a person can pick for Rumi. The screen sends only the key; the Cartesia id stays on the server side
 * of this table, so nobody can ask for a voice that is not listed.
 * Picked from Cartesia's English voice library (GET /voices, checked 2026-11-05): calm, clear, supportive ones.
 */
export const VOICES = [
  { key: "jacqueline", label: "Jacqueline", gender: "female", note: "Warm and empathic", id: "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc" },
  { key: "michelle", label: "Michelle", gender: "female", note: "Gentle and reassuring", id: "d7bf7d75-64b7-4c1e-86c0-79d647366587" },
  { key: "julia", label: "Julia", gender: "female", note: "Soft and graceful", id: "273f9ef7-9fc2-4def-88bb-ab108c6249ca" },
  { key: "joseph", label: "Joseph", gender: "male", note: "Gentle and reassuring", id: "7d444628-dd13-442b-b687-71a6baf0c07e" },
  { key: "zander", label: "Zander", gender: "male", note: "Calm and measured", id: "aa2cafe9-97ba-4052-ac3c-875000f95212" },
  { key: "gareth", label: "Gareth", gender: "male", note: "Warm and approachable", id: "3a01612e-07da-4a85-bba8-ce10481df477" },
] as const;

export type VoiceKey = (typeof VOICES)[number]["key"];
export const DEFAULT_VOICE: VoiceKey = "jacqueline";
export const VOICE_KEYS = VOICES.map((v) => v.key) as [VoiceKey, ...VoiceKey[]];

/** What a picker needs: no ids. */
export const VOICE_OPTIONS = VOICES.map(({ key, label, gender, note }) => ({ key, label, gender, note }));

export const voiceIdFor = (key: VoiceKey): string => (VOICES.find((v) => v.key === key) ?? VOICES[0]).id;
