import { Link } from 'react-router-dom';

export function SiteNav() {
  return (
    <header className="site-nav">
      <Link className="site-nav__brand" to="/">Reference Material &amp; Commission Artworks</Link>
    </header>
  );
}
