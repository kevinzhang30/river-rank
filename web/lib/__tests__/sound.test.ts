import { describe, it, expect, beforeEach, vi } from "vitest";
import { getVolume, setVolume, getSoundDuration } from "../sound";

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

beforeEach(() => {
  localStorageMock.clear();
});

describe("volume persistence", () => {
  it("returns default volume when nothing is stored", () => {
    expect(getVolume()).toBe(0.5);
  });

  it("persists and reads volume", () => {
    setVolume(0.8);
    expect(getVolume()).toBe(0.8);
  });

  it("clamps volume to [0, 1]", () => {
    setVolume(1.5);
    expect(getVolume()).toBe(1);

    setVolume(-0.5);
    expect(getVolume()).toBe(0);
  });

  it("treats 0 as mute", () => {
    setVolume(0);
    expect(getVolume()).toBe(0);
  });

  it("handles non-numeric localStorage values gracefully", () => {
    localStorage.setItem("rr:volume", "garbage");
    expect(getVolume()).toBe(0.5);
  });
});

describe("getSoundDuration", () => {
  it("returns null for uncached URLs", () => {
    expect(getSoundDuration("/sfx/emotes/nonexistent.mp3")).toBeNull();
  });
});
