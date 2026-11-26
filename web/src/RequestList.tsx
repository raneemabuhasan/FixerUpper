import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export function RequestList({ children, itemKey }: { children: ReactNode; itemKey: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  useEffect(() => {
    const root = viewport.current;
    if (!root) return;
    const update = () => setEdges({
      top: root.scrollTop > 4,
      bottom: root.scrollTop + root.clientHeight < root.scrollHeight - 4,
    });
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => entry.target.classList.toggle('in-view', entry.isIntersecting));
    }, { root, threshold: 0.08 });
    root.querySelectorAll('.ticket').forEach(item => observer.observe(item));
    const resize = new ResizeObserver(update);
    resize.observe(root);
    root.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      resize.disconnect();
      root.removeEventListener('scroll', update);
    };
  }, [itemKey]);

  return <div className={`request-list-frame${edges.top ? ' fade-top' : ''}${edges.bottom ? ' fade-bottom' : ''}`}>
    <div ref={viewport} className="request-list" role="region" aria-label="Maintenance requests" tabIndex={0} onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>('.ticket'));
      if (!links.length) return;
      const current = links.indexOf(document.activeElement as HTMLAnchorElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1
        : event.key === 'ArrowDown' ? Math.min(current + 1, links.length - 1) : Math.max(current - 1, 0);
      event.preventDefault();
      links[next].focus({ preventScroll: true });
      links[next].scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }}>
      {children}
    </div>
  </div>;
}
