/**
 * Store items. Styling only: nothing here may reach the sim, so a bought item never changes how a kart drives.
 * A player's active items travel as a bitmask in the room state, so everyone in the room sees them.
 */
export interface CosmeticDef {
  /** key in the player's saved progress (lowercase letters only) */
  id: string;
  /** bit in the cosmetics mask */
  bit: number;
  name: string;
  icon: string;
  desc: string;
  /** Chaos Coins */
  price: number;
  /** how long one purchase lasts */
  days: number;
}

export const Cosmetic = {
  GridGirls: 1 << 0,
  Underglow: 1 << 1,
  Trail: 1 << 2,
  Crown: 1 << 3,
  Flag: 1 << 4,
  Gold: 1 << 5,
  Confetti: 1 << 6,
} as const;

export const COSMETICS: readonly CosmeticDef[] = [
  { id: "gridgirls", bit: Cosmetic.GridGirls, name: "Grid Girls", icon: "💃", desc: "Two umbrella girls stand beside your kart on the starting grid and wave you off.", price: 10, days: 14 },
  { id: "gold", bit: Cosmetic.Gold, name: "Gold Chrome", icon: "✨", desc: "Your kart's body is plated in polished gold.", price: 20, days: 14 },
  { id: "crown", bit: Cosmetic.Crown, name: "Royal Crown", icon: "👑", desc: "A spinning golden crown floats above your driver.", price: 12, days: 14 },
  { id: "trail", bit: Cosmetic.Trail, name: "Rainbow Trail", icon: "🌈", desc: "A rainbow ribbon streams behind your kart while you drive.", price: 8, days: 7 },
  { id: "underglow", bit: Cosmetic.Underglow, name: "Neon Underglow", icon: "💡", desc: "Colour-cycling neon lights under your kart.", price: 6, days: 7 },
  { id: "flag", bit: Cosmetic.Flag, name: "Racing Flag", icon: "🏁", desc: "A chequered flag waves from the back of your kart.", price: 5, days: 7 },
  { id: "confetti", bit: Cosmetic.Confetti, name: "Victory Confetti", icon: "🎉", desc: "A confetti cannon goes off when you cross the finish line.", price: 6, days: 7 },
];

export const COSMETIC_MASK = COSMETICS.reduce((m, c) => m | c.bit, 0);

/** Whatever a peer sent -> a valid mask (unknown bits dropped). */
export const cleanCosmetics = (v: unknown): number => (Number.isInteger(v) ? (v as number) & COSMETIC_MASK : 0);
