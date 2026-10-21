import { fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mountPresetPicker } from "./mountPresetPicker";
import type { PresetId } from "./presets";

function mount(value: PresetId, onChange = vi.fn()) {
  const el = document.createElement("div");
  mountPresetPicker(el, {
    value,
    label: "Preset",
    optionLabel: (preset) => `Label for ${preset}`,
    onChange,
  });
  return within(el).getByRole<HTMLSelectElement>("combobox", { name: /Preset/ });
}

describe("mountPresetPicker", () => {
  it("lists every preset under its label, with the current one selected", () => {
    const select = mount("solarized");

    expect([...select.options].map((option) => [option.value, option.text])).toEqual([
      ["none", "Label for none"],
      ["sepia", "Label for sepia"],
      ["solarized", "Label for solarized"],
      ["high-contrast", "Label for high-contrast"],
    ]);
    expect(select.value).toBe("solarized");
  });

  it("reports the preset the user picks", () => {
    const onChange = vi.fn();
    const select = mount("none", onChange);

    fireEvent.change(select, { target: { value: "high-contrast" } });

    expect(onChange).toHaveBeenCalledWith("high-contrast");
  });
});
