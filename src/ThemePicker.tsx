import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Check,
  Monitor,
  Moon,
  Palette as PaletteIcon,
  Sun,
  X,
} from "lucide-react";
import { palettes, type ColorMode, type Palette } from "./themes";
import "./theme-picker.css";

interface ThemePickerProps {
  mode: ColorMode;
  palette: Palette;
  resolvedMode: "light" | "dark";
  onModeChange: (mode: ColorMode) => void;
  onPaletteChange: (palette: Palette) => void;
}

export function ThemePicker({
  mode,
  palette,
  resolvedMode,
  onModeChange,
  onPaletteChange,
}: ThemePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = palettes.find((option) => option.id === palette)!;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="icon-button"
          aria-label={`Theme: ${selected.name}, ${mode}. Open appearance`}
          title="Themes and appearance"
        >
          <PaletteIcon size={17} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content theme-dialog">
          <Dialog.Title>Appearance</Dialog.Title>
          <Dialog.Description>
            Choose a palette and color mode.
          </Dialog.Description>
          <Dialog.Close asChild>
            <button
              className="icon-button dialog-close"
              aria-label="Close theme picker"
            >
              <X size={18} />
            </button>
          </Dialog.Close>
          <fieldset className="theme-fieldset">
            <legend>Color mode</legend>
            <div className="theme-mode-options">
              {(
                [
                  { id: "light", label: "Light", Icon: Sun },
                  { id: "dark", label: "Dark", Icon: Moon },
                  { id: "system", label: "System", Icon: Monitor },
                ] as const
              ).map(({ id, label, Icon }) => (
                <label className="theme-mode" key={id}>
                  <input
                    type="radio"
                    name="fresher-color-mode"
                    value={id}
                    checked={mode === id}
                    onChange={() => onModeChange(id)}
                  />
                  <span>
                    <Icon size={15} />
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="theme-fieldset theme-palette-fieldset">
            <legend>Palette</legend>
            <div className="theme-palette-grid">
              {palettes.map((option) => (
                <label className="theme-option" key={option.id}>
                  <input
                    type="radio"
                    name="fresher-palette"
                    value={option.id}
                    aria-label={option.name}
                    checked={palette === option.id}
                    onChange={() => onPaletteChange(option.id)}
                  />
                  <span className="theme-option-card">
                    <span
                      className="theme-sample"
                      data-palette={option.id}
                      data-theme={resolvedMode}
                      aria-hidden="true"
                    >
                      <span className="sample-sidebar">
                        <i className="sample-brand" />
                        <i />
                        <i />
                        <i />
                      </span>
                      <span className="sample-list">
                        <i />
                        <span />
                        <span />
                        <span />
                      </span>
                      <span className="sample-article">
                        <i />
                        <i />
                        <span />
                        <span />
                        <span />
                        <span />
                      </span>
                    </span>
                    <span className="theme-option-label">
                      <strong>{option.name}</strong>
                      <span className="theme-selected-mark" aria-hidden="true">
                        {palette === option.id && <Check size={12} />}
                      </span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="theme-save-note">
            <Check size={12} /> Saved on this device.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
