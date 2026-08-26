import { getSourcePlatform } from '../translations';
import { ModernImage } from './ModernImage';

export function CommissionCard({ commission, character, index, onImageClick, lang = 'en' }) {
    const type = commission.type || commission.title || 'Commission';
    const formattedDate = commission.date
        ? new Date(commission.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
        : null;
    const platform = commission.sourceUrl ? getSourcePlatform(commission.sourceUrl, lang) : null;
    const openImage = () => onImageClick(commission.image, commission, false);

    return (
        <div
            className="commission-card"
            style={{
                animation: `slideUp 0.4s ease ${Math.min(index, 8) * 0.05}s both`,
                '--card-accent': character.color,
            }}
            onClick={openImage}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openImage();
                }
            }}
            role="button"
            tabIndex={0}
        >
            <ModernImage
                className="commission-image"
                src={commission.thumbnail || commission.image}
                alt={`${type} by ${commission.artist}`}
            />
            {platform && (
                <div className="commission-platform-badge">
                    <span className="commission-platform-icon">{platform.icon}</span>
                    <span className="commission-platform-label">{platform.type}</span>
                </div>
            )}
            <div className="commission-overlay">
                <h3 className="commission-title">[{type}]</h3>
                <p className="commission-artist" style={{ color: character.color }}>
                    by {commission.artist}
                </p>
                {formattedDate && <p className="commission-date">{formattedDate}</p>}
            </div>
        </div>
    );
}
