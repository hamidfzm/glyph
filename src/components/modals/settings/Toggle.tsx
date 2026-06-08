// Settings form primitive: an on/off toggle switch.
export function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="settings-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="settings-toggle-track" />
      <span className="settings-toggle-thumb" />
    </label>
  );
}
