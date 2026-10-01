import { describe, expect, it } from "vitest";
import { newId } from "./ids";
import { ArtworkInput, ArtworkPatch, ClientInput, UploadRequest } from "./schemas";

describe("schemas", () => {
  it("accepts a minimal artwork and rejects unknown fields", () => {
    expect(ArtworkInput.safeParse({ title: "Heron" }).success).toBe(true);
    expect(ArtworkInput.safeParse({ title: "Heron", studioId: newId() }).success).toBe(false);
  });

  it("keeps money in integer cents", () => {
    expect(ArtworkPatch.safeParse({ priceCents: 1200.5 }).success).toBe(false);
    expect(ArtworkPatch.safeParse({ priceCents: -1 }).success).toBe(false);
  });

  it("rejects an empty patch", () => {
    expect(ArtworkPatch.safeParse({}).success).toBe(false);
  });

  it("lowercases client emails (D-021)", () => {
    expect(ClientInput.parse({ name: "Hendersons", email: "Ann@Example.COM" }).email).toBe("ann@example.com");
  });

  it("caps uploads at 100 MB", () => {
    expect(UploadRequest.safeParse({ name: "a.jpg", contentType: "image/jpeg", size: 101 * 1024 * 1024 }).success).toBe(false);
  });

  it("only takes ULIDs as client-supplied ids", () => {
    expect(ArtworkInput.safeParse({ title: "x", id: "123" }).success).toBe(false);
    expect(ArtworkInput.safeParse({ title: "x", id: newId() }).success).toBe(true);
  });
});
