import type {
  BlockTextSize,
  BlockTextStyle,
  BlockTextWeight,
  BlockType,
} from "@/types/templates";

export const BLOCK_TEXT_SIZE_OPTIONS: Array<{
  value: BlockTextSize;
  label: string;
}> = [
  { value: "xs", label: "XS" },
  { value: "sm", label: "SM" },
  { value: "base", label: "Base" },
  { value: "lg", label: "LG" },
  { value: "xl", label: "XL" },
  { value: "2xl", label: "2XL" },
];

export const BLOCK_TEXT_WEIGHT_OPTIONS: Array<{
  value: BlockTextWeight;
  label: string;
}> = [
  { value: "light", label: "Light" },
  { value: "normal", label: "Normal" },
  { value: "medium", label: "Medium" },
  { value: "semibold", label: "Semibold" },
  { value: "bold", label: "Bold" },
];

export const BLOCK_TEXT_SIZE_CLASS: Record<BlockTextSize, string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
};

export const BLOCK_TEXT_WEIGHT_CLASS: Record<BlockTextWeight, string> = {
  light: "font-light",
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
};

const BLOCK_TEXT_SIZE_PT: Record<BlockTextSize, number> = {
  xs: 10,
  sm: 11,
  base: 12,
  lg: 14,
  xl: 16,
  "2xl": 20,
};

const BLOCK_TEXT_WEIGHT_CSS: Record<BlockTextWeight, number> = {
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

export function isBlockTextSize(value: unknown): value is BlockTextSize {
  return (
    value === "xs" ||
    value === "sm" ||
    value === "base" ||
    value === "lg" ||
    value === "xl" ||
    value === "2xl"
  );
}

export function isBlockTextWeight(value: unknown): value is BlockTextWeight {
  return (
    value === "light" ||
    value === "normal" ||
    value === "medium" ||
    value === "semibold" ||
    value === "bold"
  );
}

export function sanitizeBlockTextStyle(input: unknown): BlockTextStyle | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const raw = input as { size?: unknown; weight?: unknown };
  const size = isBlockTextSize(raw.size) ? raw.size : undefined;
  const weight = isBlockTextWeight(raw.weight) ? raw.weight : undefined;
  if (!size && !weight) return undefined;
  return { size, weight };
}

export function defaultTextSizeForBlock(
  type: BlockType,
  headingLevel?: number,
): BlockTextSize {
  if (type === "heading") {
    const level = Math.max(1, Math.min(3, headingLevel ?? 1));
    return level === 1 ? "2xl" : level === 2 ? "xl" : "lg";
  }
  if (type === "subtitle") return "lg";
  return "base";
}

export function defaultTextWeightForBlock(type: BlockType): BlockTextWeight {
  if (type === "heading") return "semibold";
  if (type === "subtitle") return "medium";
  return "normal";
}

export function resolveBlockTextStyle(input: {
  type: BlockType;
  headingLevel?: number;
  textStyle?: BlockTextStyle;
}): { size: BlockTextSize; weight: BlockTextWeight } {
  const size = isBlockTextSize(input.textStyle?.size)
    ? input.textStyle.size
    : defaultTextSizeForBlock(input.type, input.headingLevel);
  const weight = isBlockTextWeight(input.textStyle?.weight)
    ? input.textStyle.weight
    : defaultTextWeightForBlock(input.type);
  return { size, weight };
}

export function blockTextSizeToPdfPt(size: BlockTextSize): number {
  return BLOCK_TEXT_SIZE_PT[size];
}

export function blockTextWeightToCss(weight: BlockTextWeight): number {
  return BLOCK_TEXT_WEIGHT_CSS[weight];
}
