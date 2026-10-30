/**
 * SM Live — Avatar (Prompt 13).
 *
 * Renders a circular avatar. Three rendering modes (in priority order):
 *   1. If `imageUrl` is non-empty AND not a placeholder `""`, render an
 *      <Image>. (The backend stores avatar URLs as `""` for users who
 *      haven't uploaded one — we treat that as "no avatar".)
 *   2. Otherwise render the first letter of `name` on a brand-tinted
 *      background — same convention as the existing Profile screen.
 *   3. If `name` is empty too, render a generic person glyph.
 *
 * The size prop maps to a fixed diameter; sizes 32 / 40 / 56 / 72 cover
 * the row / list / profile / hero use cases. Avoid ad-hoc numbers.
 */
import { Image, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { radius } from "../theme/spacing";

export interface AvatarProps {
  name?: string | null;
  imageUrl?: string | null;
  size?: 28 | 32 | 36 | 40 | 44 | 48 | 56 | 72;
  vipLevel?: number;
}

export function Avatar({ name, imageUrl, size = 40, vipLevel }: AvatarProps) {
  const letter = (name ?? "").trim().slice(0, 1).toUpperCase() || "?";
  const fontSize = size <= 32 ? 13 : size <= 40 ? 16 : size <= 56 ? 22 : 28;
  // VIP ring only when level > 0 — keeps the default avatar clean.
  const ring = vipLevel && vipLevel > 0 ? { borderWidth: 2, borderColor: theme.vip } : null;
  return (
    <View style={[s.wrap, { width: size, height: size, borderRadius: size / 2 }, ring]}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={[s.img, { width: size, height: size, borderRadius: size / 2 }]} />
      ) : (
        <View style={[s.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={[s.letter, { fontSize }]}>{letter}</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  img: {
    resizeMode: "cover",
  },
  fallback: {
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  letter: {
    color: theme.textInverse,
    fontWeight: "800",
  },
});

// re-export radius so consumers that want a pill avatar can compute it
export { radius };
