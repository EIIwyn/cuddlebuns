import { getSourcePlatform } from '../translations';
import { ModernImage } from './ModernImage';

export function CommissionCard({ commission, onImageClick, lang = 'en' }) {
  const type = commission.type || commission.title || 'Commission';
  const formattedDate = commission.date
    ? new Date(commission.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
    : null;
  const platform = commission.sourceUrl ? getSourcePlatform(commission.sourceUrl, lang) : null;

  return (
    <article className="commission-card">
      <button
        className="commission-card__art"
        onClick={() => onImageClick(commission.image, commission, false)}
        aria-label={`Open ${type} by ${commission.artist}`}
      >
        <ModernImage
          className="commission-image"
          src={commission.image}
          alt={`${type} by ${commission.artist}`}
          sizes="(max-width: 640px) 50vw, (max-width: 1100px) 33vw, 25vw"
        />
        {platform && <span className="commission-card__source">{platform.type} ↗</span>}
      </button>
      <footer className="commission-card__caption">
        <div>
          <span className="commission-card__type">{type}</span>
          <span className="commission-card__artist">{commission.artist}</span>
        </div>
        {formattedDate && <time dateTime={commission.date}>{formattedDate}</time>}
      </footer>
    </article>
  );
}
