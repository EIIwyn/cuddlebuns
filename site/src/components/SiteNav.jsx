import { Link } from 'react-router-dom';

export function SiteNav({
  title = 'Reference Material & Commission Artworks',
  to = '/',
  showBack = false,
}) {
  return (
    <header className="site-nav">
      <Link
        className={`site-nav__brand${showBack ? ' site-nav__brand--back' : ''}`}
        to={to}
        aria-label={showBack ? `Return to gallery from ${title}` : undefined}
      >
        {showBack && <span className="site-nav__back-arrow" aria-hidden="true">←</span>}
        <span>{title}</span>
      </Link>
    </header>
  );
}
