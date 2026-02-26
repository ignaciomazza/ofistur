/* eslint-disable jsx-a11y/alt-text */
import React from "react";
import { View, Text } from "@react-pdf/renderer";
import type { TextProps } from "@react-pdf/renderer";
import {
  NBSP,
  stripZeroWidth,
  expandTabs,
  preserveSpaces,
} from "@/lib/whitespace";

type PdfTextStyle = TextProps["style"];

const MAX_TEXT_LEN = 120_000;

type MdToken = { text: string; bold: boolean };

/** Tokeniza *negrita* con \* para escapar */
function tokenizeBold(line: string): MdToken[] {
  const out: MdToken[] = [];
  let buf = "";
  let bold = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === "\\" && line[i + 1] === "*") {
      buf += "*";
      i++;
      continue;
    }
    if (ch === "*") {
      if (buf) out.push({ text: buf, bold });
      bold = !bold;
      buf = "";
      continue;
    }
    buf += ch;
  }

  if (buf) out.push({ text: buf, bold });
  return out.length ? out : [{ text: line || NBSP, bold: false }];
}

/**
 * ParagraphSafe:
 * - CRLF/CR -> LF (lo hace acá).
 * - Cada línea se renderiza como **un <Text> separado** (sin "\n").
 * - Dentro de la línea, los segmentos (con o sin negrita) son hijos <Text>.
 * - Las líneas vacías se preservan con NBSP.
 * - Aplica `fontFamily` explícito para evitar fallbacks.
 */
export default function ParagraphSafe({
  text,
  style,
}: {
  text?: string | null;
  style?: PdfTextStyle;
}) {
  const raw = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .slice(0, MAX_TEXT_LEN);
  const normalized = preserveSpaces(expandTabs(stripZeroWidth(raw)));
  const lines = normalized.split("\n");

  const styleArray: object[] = Array.isArray(style)
    ? (style.filter(Boolean) as object[])
    : style
      ? [style as object]
      : [];

  return (
    <View>
      {lines.map((ln, li) => {
        const lineStyle = [...styleArray] as TextProps["style"];
        if (!ln.length) {
          return (
            <Text key={`line-${li}`} style={lineStyle}>
              {" "}
            </Text>
          );
        }
        const toks = tokenizeBold(ln);
        const hasBold = toks.some((tk) => tk.bold);

        return (
          <Text key={`line-${li}`} style={lineStyle}>
            {!hasBold
              ? toks.map((tk) => tk.text).join("")
              : toks.map((tk, ti) =>
                  tk.bold ? (
                    <Text
                      key={`seg-${li}-${ti}`}
                      style={[{ fontWeight: 700 }] as TextProps["style"]}
                    >
                      {tk.text}
                    </Text>
                  ) : (
                    tk.text
                  ),
                )}
          </Text>
        );
      })}
    </View>
  );
}
