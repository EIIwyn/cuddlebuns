import { translations } from '../translations';
import { CommissionCard } from './CommissionCard';

export function CommissionsGrid({ character, commissions, versionName, onImageClick, sortOrder, onSortChange, lang = 'en' }) {
    const t = translations[lang];

    if (commissions.length === 0) {
        return (
            <div className="empty-state">
                <p className="empty-state__icon">🎨</p>
                <p>
                    {t.noCommissions} {character.name}
                    {versionName && versionName !== 'Default' && ` (${versionName})`}
                </p>
            </div>
        );
    }

    return (
        <div className="commissions-container">
            {/* Sort Controls */}
            <div className="sort-controls">
                <button
                    className={`sort-btn ${sortOrder === 'recency' ? 'sort-btn--active' : ''}`}
                    style={{
                        borderColor: sortOrder === 'recency' ? character.color : 'rgba(255,255,255,0.2)',
                        background: sortOrder === 'recency' ? `${character.color}20` : 'transparent',
                        color: sortOrder === 'recency' ? character.color : 'rgba(255,255,255,0.6)',
                    }}
                    onClick={() => onSortChange('recency')}
                >
                    {t.newest}
                </button>
                <button
                    className={`sort-btn ${sortOrder === 'random' ? 'sort-btn--active' : ''}`}
                    style={{
                        borderColor: sortOrder === 'random' ? character.color : 'rgba(255,255,255,0.2)',
                        background: sortOrder === 'random' ? `${character.color}20` : 'transparent',
                        color: sortOrder === 'random' ? character.color : 'rgba(255,255,255,0.6)',
                    }}
                    onClick={() => onSortChange('random')}
                >
                    {t.randomize}
                </button>
            </div>

            <div className="commissions-grid">
                {commissions.map((commission, index) => (
                    <CommissionCard
                        key={commission.id}
                        commission={commission}
                        character={character}
                        index={index}
                        onImageClick={onImageClick}
                        lang={lang}
                    />
                ))}
            </div>
        </div>
    );
}
