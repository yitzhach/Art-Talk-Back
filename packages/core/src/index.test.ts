import { describe, expect, it } from "vitest";
import { apiError } from "./index";

describe("apiError", () => {
  it("builds the spec's error shape", () => {
    expect(apiError("not_found", "No such artwork")).toEqual({
      error: { code: "not_found", message: "No such artwork" },
    });
  });

  it("includes details only when given", () => {
    expect(apiError("version_conflict", "Stale", { current: 3 }).error.details).toEqual({ current: 3 });
  });
});
