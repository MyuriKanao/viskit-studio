const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const BRAND_ACCENT_PROPERTIES = [
  '--accent',
  '--accent-soft',
  '--accent-deep',
  '--accent-glow',
  '--accent-wash',
] as const;

export function isHexColor(value: string | null | undefined): value is string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value);
}

function hexToRgb(hex: string): RgbColor {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }: RgbColor): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function mix(a: RgbColor, b: RgbColor, amount: number): RgbColor {
  return {
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  };
}

export function applyBrandAccent(hex: string | null | undefined): void {
  if (typeof document === 'undefined') return;

  const rootStyle = document.documentElement.style;
  if (!isHexColor(hex)) {
    for (const property of BRAND_ACCENT_PROPERTIES) {
      rootStyle.removeProperty(property);
    }
    return;
  }

  const accent = hexToRgb(hex);
  const soft = mix(accent, { r: 255, g: 255, b: 255 }, 0.22);
  const deep = mix(accent, { r: 0, g: 0, b: 0 }, 0.28);

  rootStyle.setProperty('--accent', hex);
  rootStyle.setProperty('--accent-soft', rgbToHex(soft));
  rootStyle.setProperty('--accent-deep', rgbToHex(deep));
  rootStyle.setProperty('--accent-glow', `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.22)`);
  rootStyle.setProperty('--accent-wash', `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.1)`);
}
