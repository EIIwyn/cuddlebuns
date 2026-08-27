import { translations } from '../translations';
import { CommissionCard } from './CommissionCard';

export function CommissionsGrid({
  commissions,
  totalCount,
  versionName,
  onImageClick,
  sortOrder,
  onSortChange,
  lang = 'en',
}) {
  const t = translations[lang];

  return (
    <section className="commission-section" aria-labelledby="gallery-heading">
      <header className="commission-section__header">
        <div>
          <h2 id="gallery-heading">Previous commissions</h2>
          <p className="commission-section__count">
            {totalCount} {totalCount === 1 ? 'artwork' : 'artworks'}
            {versionName ? ` · ${versionName}` : ''}
          </p>
        </div>
        <div className="sort-links" aria-label="Gallery order">
          <span>Order</span>
          <button
            className={sortOrder === 'recency' ? 'is-active' : ''}
            onClick={() => onSortChange('recency')}
            aria-pressed={sortOrder === 'recency'}
          >
            {t.newest}
          </button>
          <button
            className={sortOrder === 'random' ? 'is-active' : ''}
            onClick={() => onSortChange('random')}
            aria-pressed={sortOrder === 'random'}
          >
            Shuffle
          </button>
        </div>
      </header>

      {commissions.length === 0 ? (
        <div className="empty-state">
          <p>No published artwork for this version yet.</p>
        </div>
      ) : (
        <div className="commissions-grid">
          {commissions.map((commission) => (
            <CommissionCard
              key={commission.id}
              commission={commission}
              onImageClick={onImageClick}
              lang={lang}
            />
          ))}
        </div>
      )}
    </section>
  );
}
