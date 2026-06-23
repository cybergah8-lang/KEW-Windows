// Kew — keklik (chukar partridge) mark. Cybergah Group.
// Uses the same rendered medallion as the launcher icon for a consistent brand.
import logoUrl from "./logo.png";

export function KewLogo({ size = 96 }: { size?: number }) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt="Kew"
      draggable={false}
      style={{ display: "inline-block", verticalAlign: "middle", userSelect: "none" }}
    />
  );
}
