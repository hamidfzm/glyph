interface SettingsSyncPluginRowProps {
  name: string;
  detail: string;
  /** The row's button, for a plugin this machine can act on. */
  action?: {
    label: string;
    ariaLabel: string;
    onClick: () => void;
    disabled: boolean;
  };
}

/** One plugin of the synced setup and what this machine can do about it. */
export function SettingsSyncPluginRow({ name, detail, action }: SettingsSyncPluginRowProps) {
  return (
    <li className="settings-row">
      <div>
        <span className="settings-label">{name}</span>
        <div className="settings-description">{detail}</div>
      </div>
      {action && (
        <button
          type="button"
          className="settings-secondary-btn"
          aria-label={action.ariaLabel}
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.label}
        </button>
      )}
    </li>
  );
}
