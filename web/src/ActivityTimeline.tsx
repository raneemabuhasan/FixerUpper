import { Link } from 'react-router-dom';
import type { ActivityEvent, Ticket } from '../../shared/types';

function eventLabel(event: ActivityEvent) {
  if (event.kind === 'worker') return 'Maintenance update';
  if (event.kind === 'system') return 'Request update';
  return event.text === 'Resident confirmed the repair.' ? 'Repair confirmed' : 'Resident update';
}

function EventIcon({ event }: { event: ActivityEvent }) {
  const path = event.text === 'Resident confirmed the repair.' ? 'm5 12 4 4L19 6'
    : event.kind === 'worker' ? 'm14 6 4 4M5 19l9-9M14 6a5 5 0 0 0 6 6L22 5l-4 2-1-4-3 3ZM3 17l4 4'
      : event.kind === 'resident' ? 'M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'
        : 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z';
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
}

function formatTime(at: string) {
  const date = new Date(at);
  const today = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return today ? `Today, ${time}` : date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function ActivityTimeline({ tickets }: { tickets: Ticket[] }) {
  const items = tickets.flatMap(ticket => ticket.events.map((event, index) => ({ ticket, event, index })))
    .sort((a, b) => Date.parse(b.event.at) - Date.parse(a.event.at) || b.index - a.index)
    .slice(0, 4);

  if (!items.length) return <p className="empty">No activity yet. Updates will appear here when a request is submitted.</p>;

  return <ol className="activity-timeline" aria-label="Latest request updates">
    {items.map(({ ticket, event, index }) => <li className="activity-timeline-item" key={`${ticket.id}-${index}`}>
      <div className="activity-timeline-rail" aria-hidden="true"><span className="activity-timeline-node"><EventIcon event={event} /></span></div>
      <details className="activity-timeline-details">
        <summary>
          <span className="activity-timeline-title">{ticket.title}</span>
          <svg className="activity-timeline-chevron" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg>
          <time dateTime={event.at} title={new Date(event.at).toLocaleString()}>{formatTime(event.at)}</time>
          <span className="activity-timeline-label">{eventLabel(event)}</span>
          <span className="activity-timeline-preview">{event.text}</span>
        </summary>
        <div className="activity-timeline-expanded">
          <p>{event.text}</p>
          <Link to={`/app/requests/${ticket.id}`}>Open request · {ticket.id}</Link>
        </div>
      </details>
    </li>)}
  </ol>;
}
