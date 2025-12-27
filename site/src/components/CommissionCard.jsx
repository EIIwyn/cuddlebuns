import { useState } from 'react';
import { getSourcePlatform } from '../translations';

export function CommissionCard({ commission, character, index, onImageClick, lang = 'en' }) {
    const [isHovered, setIsHovered] = useState(false);

    const cardStyle = {
        animation: `slideUp 0.4s ease ${index * 0.1}s both`,
        boxShadow: isHovered
            ? `0 20px 40px rgba(0,0,0,0.4), 0 0 30px ${character.color}20`
            : 'none',
        transform: isHovered ? 'translateY(-8px) scale(1.02)' : 'translateY(0) scale(1)',
    };

    const imageStyle = {
        transform: isHovered ? 'scale(1.1)' : 'scale(1)',
    };

    const formattedDate = commission.date
        ? new Date(commission.date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short'
          })
        : null;

    // Get platform info from source URL
    const platform = commission.sourceUrl ? getSourcePlatform(commission.sourceUrl, lang) : null;

    return (
        <div
            className="commission-card"
            style={cardStyle}
            onClick={() => onImageClick(commission.image, commission, false)}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <img
                className="commission-image"
                style={imageStyle}
                src={commission.image}
                alt={commission.title || `Commission by ${commission.artist}`}
            />

            {/* Platform badge - visible on hover */}
            {platform && (
                <div className="commission-platform-badge">
                    <span className="commission-platform-icon">{platform.icon}</span>
                    <span className="commission-platform-label">{platform.type}</span>
                </div>
            )}

            <div className="commission-overlay">
                <h3 className="commission-title">{commission.title || 'Commission'}</h3>
                <p className="commission-artist" style={{ color: character.color }}>
                    by {commission.artist}
                </p>
                {formattedDate && (
                    <p className="commission-date">{formattedDate}</p>
                )}
            </div>
        </div>
    );
}
