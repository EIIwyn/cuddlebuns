import { Link } from 'react-router-dom';
import { SiteNav } from '../components/SiteNav';

export function Home() {
  return (
    <div className="site-shell">
      <SiteNav title="Cuddlebuns" />
      <main className="home-landing page-width">
        <Link className="home-gallery-link" to="/gallery">
          <h1>Gallery</h1>
          <p>Reference sheets and commissioned artwork organized by character.</p>
          <span>Browse gallery <span aria-hidden="true">→</span></span>
        </Link>
      </main>
    </div>
  );
}
