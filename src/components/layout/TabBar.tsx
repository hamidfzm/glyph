import type { Tab } from "../../hooks/useTabs";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

export function TabBar({ tabs, activeTabId, onActivate, onClose }: TabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className="tab-item"
          data-active={tab.id === activeTabId || undefined}
          onClick={() => onActivate(tab.id)}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              onClose(tab.id);
            }
          }}
          title={tab.path}
        >
          <span className="tab-label">{tab.metadata?.name ?? "Untitled"}</span>
          <button
            type="button"
            className="tab-close"
            tabIndex={-1}
            aria-label={`Close ${tab.metadata?.name ?? "tab"}`}
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M3 3L9 9M9 3L3 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </button>
      ))}
    </div>
  );
}
