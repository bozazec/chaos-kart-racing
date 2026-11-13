import { DEFAULT_PARAMS, type KartParams } from "./sim";

/** 1..5 (3 = average). Top speed is the same for every driver, so skill (items, handling, specials) decides races. */
export interface CharStats {
  accel: number; // acceleration
  handling: number; // steering
  toughness: number; // shorter spin-out, keeps more speed after a hit
}

/** Item roll multipliers [boost, shield, missile, oil, drone?]; a missing entry means 1. */
export type ItemBias = readonly number[];

export interface SpecialDef {
  name: string;
  icon: string;
  desc: string;
}

export type KartShape = "classic" | "wedge" | "wide";
export type KartPart = "stripe" | "spoiler" | "fins" | "missile" | "speakers" | "gift" | "ring" | "leaf" | "solar" | "grille" | "split" | "lanterns";

/** How the driver's kart looks. Pure data; the client turns it into a 3D model. */
export interface KartStyle {
  body: number;
  accent: number;
  trim: number;
  shape: KartShape;
  parts: KartPart[];
  /** driver colors, used by the 3D side view (front/back come from the roster art) */
  skin: number;
  hair: number;
  /** shiny paint */
  metal?: boolean;
}

export interface CharacterDef {
  id: number;
  name: string;
  /** Kart body color (hex). Portrait lives at client/public/art/characters/c{id}.jpg */
  color: number;
  /** Main theme shown on the select screen. */
  theme: string;
  stats: CharStats;
  /** Gets these items more often (the theme shows up in the item luck). */
  itemBias: ItemBias;
  /** Unique power on its own button, 25 s cooldown. */
  special: SpecialDef;
  kart: KartStyle;
}

const N: ItemBias = [1, 1, 1, 1];

/**
 * Selectable drivers, in poster order. Data-driven: swap names/colors/art/stats here only.
 * Real special powers per character are planned; for now the theme biases which items they roll.
 */
export const CHARACTERS: readonly CharacterDef[] = [
  { id: 0, name: "Trump", color: 0xc0392b, theme: "Chaos", stats: { accel: 3, handling: 2, toughness: 4 }, itemBias: [1, 1, 1.2, 1.4], special: { name: "Chaos Wave", icon: "🌀", desc: "Rivals steer in reverse for 3 s" }, kart: { body: 0xc0392b, accent: 0xf4f4f4, trim: 0x1f3f9a, shape: "classic", parts: ["stripe", "spoiler"], skin: 0xf2b38c, hair: 0xf2c14e } },
  { id: 1, name: "Elon Musk", color: 0x2d333b, theme: "Technology", stats: { accel: 4, handling: 3, toughness: 1 }, itemBias: [1.6, 1, 1, 1], special: { name: "Overclock", icon: "⚙️", desc: "Long turbo boost (3.5 s)" }, kart: { body: 0x1b1f26, accent: 0xcfd8e3, trim: 0xff3b30, shape: "wedge", parts: ["fins", "stripe"], skin: 0xf0c3a0, hair: 0x4a3222, metal: true } },
  { id: 2, name: "Kim Jong Un", color: 0x4f6b3a, theme: "Rockets", stats: { accel: 2, handling: 2, toughness: 4 }, itemBias: [1, 1, 1.6, 1], special: { name: "Rocket Salvo", icon: "🚀", desc: "Fires 3 missiles in three lanes" }, kart: { body: 0x55703a, accent: 0xd62828, trim: 0x2d3a1f, shape: "wide", parts: ["missile"], skin: 0xf0c4a0, hair: 0x14110f } },
  { id: 3, name: "Putin", color: 0x2d56c4, theme: "Ice", stats: { accel: 2, handling: 4, toughness: 3 }, itemBias: [1, 1, 1, 1.6], special: { name: "Shahed Drone", icon: "🛩️", desc: "Homing drone flies over the track and hits the kart ahead of you" }, kart: { body: 0x2d56c4, accent: 0xffffff, trim: 0x9bd3ff, shape: "classic", parts: ["stripe", "spoiler"], skin: 0xe9b99a, hair: 0x8a6a55 } },
  { id: 4, name: "Greta", color: 0x2e9b45, theme: "Ecology", stats: { accel: 3, handling: 5, toughness: 2 }, itemBias: [1, 1.6, 1, 1], special: { name: "Green Shield", icon: "🌿", desc: "Shield, and clears slow/confusion" }, kart: { body: 0x2e9b45, accent: 0xf5e663, trim: 0x2d5bd6, shape: "classic", parts: ["leaf", "solar"], skin: 0xf1c8aa, hair: 0x6b4a32 } },
  { id: 5, name: "Kanye West", color: 0x1c1c1c, theme: "Music & Madness", stats: { accel: 5, handling: 1, toughness: 3 }, itemBias: [1.3, 1, 1, 1.3], special: { name: "Bass Drop", icon: "🔊", desc: "Shockwave spins out rivals within 18 m" }, kart: { body: 0x1c1c1c, accent: 0xd4af37, trim: 0x8a6b12, shape: "wide", parts: ["grille", "speakers"], skin: 0x6b4630, hair: 0x1a1a1a, metal: true } },
  { id: 6, name: "MrBeast", color: 0xe85aa0, theme: "Rewards", stats: { accel: 3, handling: 3, toughness: 3 }, itemBias: N, special: { name: "Giveaway", icon: "🎁", desc: "Everyone without an item gets one" }, kart: { body: 0xe85aa0, accent: 0x35d0ff, trim: 0xffffff, shape: "classic", parts: ["gift", "stripe"], skin: 0xf0c0a0, hair: 0x5a3a2a } },
  { id: 7, name: "Andrew Tate", color: 0xd4a017, theme: "Ego & Luxury", stats: { accel: 3, handling: 1, toughness: 3 }, itemBias: [1.2, 1.4, 1, 1], special: { name: "Gold Rush", icon: "👑", desc: "Turbo plus shield" }, kart: { body: 0xd4a017, accent: 0x111111, trim: 0xfff1a8, shape: "wide", parts: ["spoiler", "grille"], skin: 0xc79a78, hair: 0xc79a78, metal: true } },
  { id: 8, name: "Netanyahu", color: 0x2e6fd8, theme: "War Chaos", stats: { accel: 4, handling: 2, toughness: 3 }, itemBias: [1, 1.2, 1.4, 1], special: { name: "Blitz", icon: "💥", desc: "Scatters 4 slicks on the road ahead" }, kart: { body: 0x2e6fd8, accent: 0xffffff, trim: 0x1a3f8f, shape: "wedge", parts: ["stripe", "fins"], skin: 0xe8bfa4, hair: 0xc9c9cf } },
  { id: 9, name: "Zelensky", color: 0xf0c020, theme: "Bonus Packs", stats: { accel: 4, handling: 4, toughness: 2 }, itemBias: [1.3, 1.3, 1, 1], special: { name: "Shahed Drone", icon: "🛩️", desc: "Homing drone flies over the track and hits the kart ahead of you" }, kart: { body: 0x2457c5, accent: 0xf0c020, trim: 0xf0c020, shape: "classic", parts: ["split", "stripe"], skin: 0xe4b595, hair: 0x4a3425 } },
  { id: 10, name: "Zuckerberg", color: 0x1d5fd1, theme: "Digital Clones", stats: { accel: 3, handling: 4, toughness: 2 }, itemBias: [1, 1, 1.2, 1.2], special: { name: "Lag Spike", icon: "📶", desc: "Rivals within 35 m slowed for 2.5 s" }, kart: { body: 0x1d5fd1, accent: 0xffffff, trim: 0x0a3a8a, shape: "wedge", parts: ["ring", "spoiler"], skin: 0xf3cfb3, hair: 0xb06a2a } },
  { id: 11, name: "Xi Jinping", color: 0xcc2b2b, theme: "Control", stats: { accel: 2, handling: 4, toughness: 4 }, itemBias: [1, 1.5, 1, 1], special: { name: "Lockdown", icon: "🔒", desc: "Freezes the kart just ahead (refund if leading)" }, kart: { body: 0xcc2b2b, accent: 0xf5c518, trim: 0x8f1a1a, shape: "classic", parts: ["lanterns", "stripe"], skin: 0xe9bf9d, hair: 0x14141a } },
];

export const characterById = (id: number): CharacterDef => CHARACTERS[id] ?? CHARACTERS[0]!;
export const cleanCharacter = (id: unknown): number => (Number.isInteger(id) && (id as number) >= 0 && (id as number) < CHARACTERS.length ? (id as number) : 0);

const cache = new Map<number, KartParams>();
/** Physics params for a character. Host and client both derive these from the id, so prediction matches. */
export function paramsFor(id: number): KartParams {
  let p = cache.get(id);
  if (!p) {
    const s = characterById(id).stats;
    p = {
      ...DEFAULT_PARAMS,
      accel: DEFAULT_PARAMS.accel * (1 + 0.1 * (s.accel - 3)),
      steerRate: DEFAULT_PARAMS.steerRate * (1 + 0.08 * (s.handling - 3)),
      charId: id,
    };
    cache.set(id, p);
  }
  return p;
}
