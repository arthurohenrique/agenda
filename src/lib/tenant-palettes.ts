import { hasAaContrast } from "@/lib/colors";

export interface TenantPalette {
  id: "graphite" | "forest" | "ocean" | "plum" | "terracotta" | "indigo" | "rose" | "gold" | "sage" | "cobalt" | "cocoa" | "teal";
  name: string;
  description: string;
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
}

export const tenantPalettes: readonly TenantPalette[] = [
  {
    id: "graphite",
    name: "Grafite",
    description: "60 neutro · 30 grafite · 10 azul",
    primary: "#171717",
    accent: "#2563EB",
    background: "#F6F7F8",
    surface: "#FFFFFF",
    text: "#171717",
  },
  {
    id: "forest",
    name: "Floresta",
    description: "60 marfim · 30 verde · 10 menta",
    primary: "#133D35",
    accent: "#267A66",
    background: "#F4F5F1",
    surface: "#FFFFFF",
    text: "#13201C",
  },
  {
    id: "ocean",
    name: "Oceano",
    description: "60 névoa · 30 azul-petróleo · 10 turquesa",
    primary: "#0B4F6C",
    accent: "#0B7493",
    background: "#F1F7F8",
    surface: "#FFFFFF",
    text: "#102A35",
  },
  {
    id: "plum",
    name: "Ameixa",
    description: "60 lavanda clara · 30 ameixa · 10 violeta",
    primary: "#4B245F",
    accent: "#7A3E9D",
    background: "#F8F3FA",
    surface: "#FFFFFF",
    text: "#281632",
  },
  {
    id: "terracotta",
    name: "Terracota",
    description: "60 areia · 30 argila · 10 cobre",
    primary: "#6D3126",
    accent: "#A5422C",
    background: "#FBF4EF",
    surface: "#FFFDFC",
    text: "#301914",
  },
  {
    id: "indigo",
    name: "Índigo",
    description: "60 névoa azul · 30 índigo · 10 elétrico",
    primary: "#312E81",
    accent: "#4F46E5",
    background: "#F5F5FF",
    surface: "#FFFFFF",
    text: "#1E1B4B",
  },
  {
    id: "rose",
    name: "Rosa escuro",
    description: "60 pétala · 30 vinho · 10 framboesa",
    primary: "#881337",
    accent: "#BE123C",
    background: "#FFF5F7",
    surface: "#FFFFFF",
    text: "#4C0519",
  },
  {
    id: "gold",
    name: "Dourado",
    description: "60 creme · 30 bronze · 10 ouro",
    primary: "#713F12",
    accent: "#A16207",
    background: "#FFFBEB",
    surface: "#FFFFFF",
    text: "#422006",
  },
  {
    id: "sage",
    name: "Sálvia",
    description: "60 lima clara · 30 oliva · 10 folha",
    primary: "#365314",
    accent: "#4D7C0F",
    background: "#F7FCEB",
    surface: "#FFFFFF",
    text: "#1A2E05",
  },
  {
    id: "cobalt",
    name: "Cobalto",
    description: "60 azul gelo · 30 marinho · 10 cobalto",
    primary: "#1E3A8A",
    accent: "#2563EB",
    background: "#F4F7FF",
    surface: "#FFFFFF",
    text: "#172554",
  },
  {
    id: "cocoa",
    name: "Cacau",
    description: "60 linho · 30 cacau · 10 caramelo",
    primary: "#4A2C2A",
    accent: "#8B4513",
    background: "#FCF7F2",
    surface: "#FFFDFC",
    text: "#2B1715",
  },
  {
    id: "teal",
    name: "Teal",
    description: "60 água clara · 30 teal · 10 jade",
    primary: "#134E4A",
    accent: "#0F766E",
    background: "#F0FDFA",
    surface: "#FFFFFF",
    text: "#042F2E",
  },
] as const;

export const tenantPaletteIds = tenantPalettes.map((palette) => palette.id) as [
  TenantPalette["id"],
  ...TenantPalette["id"][],
];

export function getTenantPalette(id: string) {
  return tenantPalettes.find((palette) => palette.id === id) ?? null;
}

export function getTenantPaletteId(colors: Pick<TenantPalette, "primary" | "accent" | "background" | "surface" | "text">) {
  const normalized = Object.fromEntries(
    Object.entries(colors).map(([key, value]) => [key, value.toUpperCase()]),
  ) as Pick<TenantPalette, "primary" | "accent" | "background" | "surface" | "text">;

  return tenantPalettes.find((palette) =>
    palette.primary === normalized.primary
    && palette.accent === normalized.accent
    && palette.background === normalized.background
    && palette.surface === normalized.surface
    && palette.text === normalized.text,
  )?.id ?? null;
}

export function paletteHasAaContrast(palette: TenantPalette) {
  return hasAaContrast(palette.text, palette.background)
    && hasAaContrast(palette.text, palette.surface)
    && hasAaContrast("#FFFFFF", palette.primary)
    && hasAaContrast(palette.accent, palette.background);
}
