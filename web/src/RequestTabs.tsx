export type RequestView = 'current' | 'history';

export function RequestTabs({ value, counts, onChange }: {
  value: RequestView;
  counts: Record<RequestView, number>;
  onChange: (value: RequestView) => void;
}) {
  const views = ['current', 'history'] as const;
  return <div className="request-tabs" role="tablist" aria-label="Request views" data-view={value}>
    {views.map((view, index) => <button type="button" role="tab" key={view} id={`tab-${view}`} aria-controls={`panel-${view}`} aria-selected={value === view} tabIndex={value === view ? 0 : -1} onClick={() => onChange(view)} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'current' : event.key === 'End' ? 'history' : views[1 - index];
      onChange(next);
      document.getElementById(`tab-${next}`)?.focus();
    }}>
      {view === 'current' ? 'Current' : 'History'} <span>{counts[view]}</span>
    </button>)}
  </div>;
}
