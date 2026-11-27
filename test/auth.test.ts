import { describe, it, expect } from "vitest";
import { credentialsMatch } from "../src/auth.ts";

describe("credentialsMatch", () => {
  const expected = { username: "mike", password: "s3cret" };

  it("accepts the right username and password", () => {
    expect(credentialsMatch({ username: "mike", password: "s3cret" }, expected)).toBe(true);
  });

  it.each([
    ["wrong password", { username: "mike", password: "s3creT" }],
    ["wrong username", { username: "Mike", password: "s3cret" }],
    ["empty password", { username: "mike", password: "" }],
    ["longer password", { username: "mike", password: "s3cret-and-more" }],
  ])("rejects a %s", (_, given) => {
    expect(credentialsMatch(given, expected)).toBe(false);
  });
});
