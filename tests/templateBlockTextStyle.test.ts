import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  BLOCK_TEXT_SIZE_CLASS,
  BLOCK_TEXT_SIZE_OPTIONS,
  blockTextSizeToCssPx,
  blockTextSizeToPdfPt,
  isBlockTextSize,
} from "@/lib/blockTextStyle";

describe("template block text sizes", () => {
  it("supports a size below XXXS for preview and PDF", () => {
    expect(isBlockTextSize("xxxxxs")).toBe(true);
    expect(isBlockTextSize("xxxxs")).toBe(true);
    expect(BLOCK_TEXT_SIZE_OPTIONS[0]).toMatchObject({
      value: "xxxxxs",
      label: "XXXXXS",
    });
    expect(BLOCK_TEXT_SIZE_OPTIONS[1]).toMatchObject({
      value: "xxxxs",
      label: "XXXXS",
    });
    expect(BLOCK_TEXT_SIZE_CLASS.xxxxxs).toBe("text-[7px]");
    expect(BLOCK_TEXT_SIZE_CLASS.xxxxs).toBe("text-[8px]");
    expect(blockTextSizeToCssPx("xxxxxs")).toBe(7);
    expect(blockTextSizeToCssPx("xxxxs")).toBe(8);
    expect(blockTextSizeToPdfPt("xxxxxs")).toBe(6);
    expect(blockTextSizeToPdfPt("xxxxs")).toBe(7);
  });

  it("react-pdf renders the smallest block font size", async () => {
    const { Document, Page, Text, pdf } = await import("@react-pdf/renderer");
    const doc = createElement(
      Document,
      null,
      createElement(
        Page,
        { size: "A4" },
        createElement(
          Text,
          { style: { fontSize: blockTextSizeToPdfPt("xxxxxs") } },
          "Texto minimo",
        ),
      ),
    );

    const blob = await pdf(doc).toBlob();

    expect(blob.size).toBeGreaterThan(0);
  });
});
