import { Link, useLocation } from 'react-router-dom';

export function SiteNav({ title = 'Reference Material & Commission Artworks' }) {
  const { pathname } = useLocation();
  const showHomeCue = pathname.startsWith('/gallery');

  return (
    <header className="site-nav">
      <Link
        className={`site-nav__brand${showHomeCue ? ' site-nav__brand--back' : ''}`}
        to="/"
        aria-label={showHomeCue ? `Return home from ${title}` : undefined}
      >
        {showHomeCue && <span className="site-nav__back-arrow" aria-hidden="true">←</span>}
        <span>{title}</span>
      </Link>
    </header>
  );
}
