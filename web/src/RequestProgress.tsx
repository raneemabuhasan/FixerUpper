import type { Status } from '../../shared/types';

const steps = ['Submitted', 'Accepted', 'In progress', 'Completed'];
const stages: Record<Exclude<Status, 'cancelled'>, number> = {
  submitted: 0,
  assigned: 1,
  'in progress': 2,
  'awaiting update': 2,
  'awaiting resident confirmation': 2,
  resolved: 3,
};

export function RequestProgress({ status }: { status: Status }) {
  if (status === 'cancelled') return <section className="request-progress" aria-label="Request progress">
    <h2>Request cancelled</h2>
    <p className="progress-description">This request is closed. Its details and activity history remain available for reference.</p>
  </section>;
  const stage = stages[status];
  const value = (stage + 1) * 25;
  const description = status === 'awaiting resident confirmation'
    ? 'Repair reported complete. Waiting for your confirmation.'
    : status === 'awaiting update'
      ? 'Request remains open. Waiting for a maintenance update.'
      : ['Your request has been submitted.', 'Maintenance has accepted your request.', 'Maintenance is working on your request.', 'You confirmed the repair. Request completed.'][stage];

  return <section className="request-progress" aria-label="Request progress">
    <div className="progress-heading">
      <h2>Request progress</h2>
      <span>{stage + 1} of 4</span>
    </div>
    <div className="progress-track" role="progressbar" aria-label="Repair progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={`${steps[stage]}. ${description}`}>
      <div className="progress-indicator" style={{ width: `${value}%` }} />
    </div>
    <ol className="progress-steps">
      {steps.map((step, index) => <li key={step} className={index <= stage ? 'reached' : ''} aria-current={index === stage ? 'step' : undefined}>
        <span className="progress-dot" aria-hidden="true">{index < stage || status === 'resolved' ? '✓' : index + 1}</span>
        {step}
      </li>)}
    </ol>
    <p className="progress-description">{description}</p>
  </section>;
}
