import { useEffect, useState } from "react";
import { runtimeConfig } from "./runtime";

export const palettes = [
  { id: "forest", name: "Forest" },
  { id: "stone", name: "Stone" },
  { id: "sepia", name: "Sepia" },
  { id: "ocean", name: "Ocean" },
  { id: "rose", name: "Rose" },
  { id: "lavender", name: "Lavender" },
] as const;

export type Palette = (typeof palettes)[number]["id"];
export type ColorMode = "light" | "dark" | "system";

function readMode(): ColorMode {
  try {
    const value = localStorage.getItem("fresher-theme");
    return value === "light" || value === "dark" || value === "system"
      ? value
      : runtimeConfig().defaultMode;
  } catch {
    return runtimeConfig().defaultMode;
  }
}
function readPalette(): Palette {
  try {
    const value = localStorage.getItem("fresher-palette");
    return (
      palettes.find((palette) => palette.id === value)?.id ??
      runtimeConfig().defaultPalette
    );
  } catch {
    return runtimeConfig().defaultPalette;
  }
}

export function useTheme() {
  const [mode, setMode] = useState<ColorMode>(readMode);
  const [palette, setPalette] = useState<Palette>(readPalette);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const resolvedMode =
    mode === "system" ? (systemDark ? "dark" : "light") : mode;

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedMode;
    root.dataset.palette = palette;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        getComputedStyle(root).getPropertyValue("--bg").trim(),
      );
    try {
      localStorage.setItem("fresher-theme", mode);
      localStorage.setItem("fresher-palette", palette);
    } catch {
      /* Theme switching still works when storage is unavailable. */
    }
  }, [mode, palette, resolvedMode]);

  return { mode, setMode, palette, setPalette, resolvedMode };
}
