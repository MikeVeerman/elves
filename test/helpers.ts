import type { FactoryInput } from "../src/store.ts";

export function factoryInput(overrides: Partial<FactoryInput> = {}): FactoryInput {
  return {
    name: "a",
    prompt: "p",
    directory: "/a",
    kind: "loop",
    schedule: "",
    agent: "pi",
    model: "",
    idleMinutes: 30,
    maxRunMinutes: 60,
    ...overrides,
  };
}
