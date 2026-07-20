import { describe, expect, it } from "vitest";

import { classifyAttachment, textHints } from "../classify";

describe("textHints", () => {
  it("detects English and Russian keywords deterministically", () => {
    expect(textHints("Updated price list for July")).toEqual(["price-list"]);
    expect(textHints("Новый прайс-лист и мастер-план")).toEqual(["master-plan", "price-list"]);
    expect(textHints("Ход строительства, стройка идёт")).toEqual(["construction"]);
    expect(textHints("Промоакция: скидка 5%")).toEqual(["promotion"]);
    expect(textHints("Nothing relevant here")).toEqual([]);
  });

  it("does not confuse Progressive with construction progress", () => {
    expect(textHints("Progressive draft import payload")).toEqual([]);
  });
});

describe("classifyAttachment", () => {
  const file = (name: string | null) => ({ original_filename: name, kind: "file" as const });
  const photo = { original_filename: "photo_1@01-07-2026_11-00-00.jpg", kind: "photo" as const };

  it("routes named documents by filename, ignoring caption hints", () => {
    expect(classifyAttachment(file("CLK - Price List V.2.pdf"), ["master-plan"])).toEqual({
      intake_category: "price-list",
      bucket: "price_table",
      from_text_hint: false,
    });
    expect(classifyAttachment(file("Master Plan Prices.pdf"), [])).toMatchObject({
      bucket: "visual_master_plan",
    });
    expect(classifyAttachment(file("Company Brochure.pdf"), [])).toMatchObject({
      bucket: "document",
    });
  });

  it("lets caption hints route bare media and unknown files", () => {
    expect(classifyAttachment(photo, ["master-plan"])).toMatchObject({
      bucket: "visual_master_plan",
      from_text_hint: true,
    });
    expect(classifyAttachment(photo, ["construction"])).toMatchObject({
      bucket: "construction_media",
      from_text_hint: true,
    });
    expect(classifyAttachment(file("scan0001.pdf"), ["price-list"])).toMatchObject({
      bucket: "price_table",
      from_text_hint: true,
    });
  });

  it("lets filename keywords route media without a caption", () => {
    expect(classifyAttachment(file("construction-progress-july.mp4"), [])).toMatchObject({
      intake_category: "video",
      bucket: "construction_media",
      from_text_hint: false,
    });
  });

  it("is conservative: media without any deterministic signal requires manual review", () => {
    expect(classifyAttachment(photo, [])).toEqual({
      intake_category: "photo",
      bucket: "manual_review_required",
      from_text_hint: false,
    });
    expect(classifyAttachment(file("site-update.mp4"), [])).toMatchObject({
      intake_category: "video",
      bucket: "manual_review_required",
    });
    // A photo whose filename could not even be recovered stays manual review.
    expect(classifyAttachment({ original_filename: null, kind: "photo" }, [])).toMatchObject({
      bucket: "manual_review_required",
    });
  });

  it("keeps unknown non-media files in other", () => {
    expect(classifyAttachment(file("mystery.bin"), [])).toMatchObject({ bucket: "other" });
    expect(classifyAttachment(file(null), [])).toMatchObject({ bucket: "other" });
  });

  it("never routes archives by caption keywords", () => {
    expect(classifyAttachment(file("full-docs.zip"), ["price-list"])).toEqual({
      intake_category: "archive",
      bucket: "other",
      from_text_hint: false,
    });
  });
});
