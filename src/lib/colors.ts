function channelToLinear(channel: number) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string) {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return null;
  const red = channelToLinear(Number.parseInt(hex.slice(1, 3), 16));
  const green = channelToLinear(Number.parseInt(hex.slice(3, 5), 16));
  const blue = channelToLinear(Number.parseInt(hex.slice(5, 7), 16));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(first: string, second: string) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  if (firstLuminance === null || secondLuminance === null) return null;
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

export function hasAaContrast(first: string, second: string) {
  const ratio = contrastRatio(first, second);
  return ratio !== null && ratio >= 4.5;
}
