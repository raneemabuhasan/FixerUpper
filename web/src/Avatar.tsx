import { useState } from 'react';

export function Avatar({ name, src }: { name: string; src?: string }) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();

  return <span className="resident-avatar" aria-hidden="true">
    <span className="avatar-fallback">{initials || '?'}</span>
    {src && src !== failedSrc && <img className="avatar-image" src={src} alt="" onError={() => setFailedSrc(src)} />}
  </span>;
}
