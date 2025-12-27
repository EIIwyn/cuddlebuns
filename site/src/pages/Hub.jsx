import { Link } from 'react-router-dom';
import './Hub.css';

export function Hub() {
  return (
    <div className="hub-container">
      <div className="hub-content">
        <h1 className="hub-title">Cuddlebuns</h1>
        <p className="hub-subtitle">Character Gallery & Collections</p>

        <nav className="hub-nav">
          <Link to="/gallery" className="hub-link">
            <div className="hub-card">
              <h2>Character Gallery</h2>
              <p>View reference sheets and commissions</p>
            </div>
          </Link>

          {/* Placeholder for future sections */}
          <div className="hub-card hub-card-disabled">
            <h2>Such n such</h2>
            <p>Coming soon</p>
          </div>

          <div className="hub-card hub-card-disabled">
            <h2>Such n such</h2>
            <p>Coming soon</p>
          </div>
        </nav>
      </div>
    </div>
  );
}
