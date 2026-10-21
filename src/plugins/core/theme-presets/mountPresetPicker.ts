import { PRESET_IDS, type PresetId, readPreset } from "./presets";

interface PresetPickerOptions {
  value: PresetId;
  label: string;
  optionLabel: (preset: PresetId) => string;
  onChange: (preset: PresetId) => void;
}

/** Build the preset dropdown in `el`, styled with the app's settings classes. */
export function mountPresetPicker(
  el: HTMLElement,
  { value, label, optionLabel, onChange }: PresetPickerOptions,
): void {
  const row = document.createElement("label");
  row.className = "settings-row";
  const text = document.createElement("span");
  text.className = "settings-label";
  text.textContent = label;

  const select = document.createElement("select");
  select.className = "settings-select";
  for (const preset of PRESET_IDS) {
    const option = document.createElement("option");
    option.value = preset;
    option.textContent = optionLabel(preset);
    select.append(option);
  }
  select.value = value;
  select.addEventListener("change", () => onChange(readPreset(select.value)));

  row.append(text, select);
  el.append(row);
}
