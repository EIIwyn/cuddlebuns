/**
 * Character Gallery - React Application
 * 
 * A beautiful gallery for displaying character reference sheets and commissions.
 * Edit characters.json to add your own characters and artwork.
 */

const { useState, useEffect } = React;

// ============================================
// Translation Dictionary
// ============================================
const translations = {
    en: {
        galleryTitle: "Reference Sheets & Commissions",
        selectCharacter: ["Choose a character above to view their", "reference sheets and commission gallery"],
        viewRefSheet: "View Reference Sheet",
        viewCommissions: "View Past Commissions",
        newest: "Newest",
        randomize: "Randomize",
        noCommissions: "No commissions yet for",
        noRefSheet: "No reference sheet yet",
        officialRefSheet: "Official Reference Sheet",
        clickToEnlarge: "Click to enlarge",
        downloadRefSheet: "Download Reference Sheet",
        escToClose: "ESC to close",
        arrowsToNavigate: "← → to navigate",
        commissionedFrom: "Commissioned from",
        viewOnTwitter: "View on Twitter",
        viewOnVGen: "View on VGen",
        viewOnSkeb: "View on Skeb",
        viewSource: "View Source",
        commissionTOS: "Commission ToS follow platform guidelines",
        loadingGallery: "Loading gallery...",
        unableToLoad: "Unable to load gallery",
        makeSureJSON: "Make sure",
        existsAndValid: "exists and is valid JSON.",
        previousRefSheet: "Previous reference sheet",
        nextRefSheet: "Next reference sheet",
        // Character species translations
        species: {
            "Kobold": "Kobold",
            "Cyber Princess": "Cyber Princess",
            "Gloomy Librarian": "Gloomy Librarian",
            "Happy Robo": "Happy Robo",
            "Delusional Artist": "Delusional Artist",
            "Art Cute Student": "Art Cute Student",
            "Devil Maid": "Devil Maid",
            "Pretty Derby": "Pretty Derby",
            "Mostly Video Games": "Mostly Video Games"
        },
        characterNames: {
            "UmaMusume": "UmaMusume"
        }
    },
    ja: {
        galleryTitle: "リファレンスシート＆コミッション",
        selectCharacter: ["上のキャラクターを選択して、", "リファレンスシートとコミッションギャラリーを表示します"],
        viewRefSheet: "リファレンスシートを見る",
        viewCommissions: "過去のコミッションを見る",
        newest: "最新順",
        randomize: "ランダム",
        noCommissions: "まだコミッションがありません：",
        noRefSheet: "リファレンスシートはまだありません",
        officialRefSheet: "公式リファレンスシート",
        clickToEnlarge: "クリックして拡大",
        downloadRefSheet: "リファレンスシートをダウンロード",
        escToClose: "ESCで閉じる",
        arrowsToNavigate: "← →でナビゲート",
        commissionedFrom: "コミッション元：",
        viewOnTwitter: "Twitterで見る",
        viewOnVGen: "VGenで見る",
        viewOnSkeb: "Skebで見る",
        viewSource: "ソースを見る",
        commissionTOS: "コミッション利用規約はプラットフォームのガイドラインに従います",
        loadingGallery: "ギャラリーを読み込み中...",
        unableToLoad: "ギャラリーを読み込めません",
        makeSureJSON: "確認してください：",
        existsAndValid: "が存在し、有効なJSONであること。",
        previousRefSheet: "前のリファレンスシート",
        nextRefSheet: "次のリファレンスシート",
        // Character species translations
        species: {
            "Kobold": "コボルド",
            "Cyber Princess": "サイバープリンセス",
            "Gloomy Librarian": "陰気な司書",
            "Happy Robo": "ハッピーロボ",
            "Delusional Artist": "妄想アーティスト",
            "Art Cute Student": "カワイイを専門とする美術学生",
            "Devil Maid": "悪魔メイド",
            "Pretty Derby": "プリティーダービー",
            "Mostly Video Games": "主にビデオゲーム"
        },
        characterNames: {
            "UmaMusume": "ウマ娘"
        }
    }
};

// Helper function to translate species
function translateSpecies(species, lang = 'en') {
    return translations[lang]?.species?.[species] || species;
}

// Helper function to translate character names
function translateCharacterName(name, lang = 'en') {
    return translations[lang]?.characterNames?.[name] || name;
}

// ============================================
// Platform Detection Utility
// ============================================
function getSourcePlatform(url, lang = 'en') {
    if (!url) return null;
    const lowerUrl = url.toLowerCase();
    const t = translations[lang];

    if (lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com')) {
        return { type: 'twitter', label: t.viewOnTwitter, icon: '𝕏' };
    }
    if (lowerUrl.includes('vgen.co')) {
        return { type: 'vgen', label: t.viewOnVGen, icon: 'V' };
    }
    if (lowerUrl.includes('skeb.jp')) {
        return { type: 'skeb', label: t.viewOnSkeb, icon: 'S' };
    }

    // Generic source
    return { type: 'source', label: t.viewSource, icon: '🔗' };
}

// ============================================
// Social Link Utility
// ============================================
function getLinkInfo(type) {
    const linkTypes = {
        twitter: { label: 'Twitter', icon: '𝕏', className: 'twitter' },
        vgen: { label: 'VGen', icon: 'V', className: 'vgen' },
        vsona: { label: 'VSona', icon: 'VS', className: 'vsona' },
        carrd: { label: 'Carrd', icon: '🔗', className: 'carrd' },
        twitch: { label: 'Twitch', icon: '📺', className: 'twitch' },
        youtube: { label: 'YouTube', icon: '▶', className: 'youtube' },
        discord: { label: 'Discord', icon: '💬', className: 'discord' },
        linktree: { label: 'Linktree', icon: '🌳', className: 'linktree' },
        website: { label: 'Website', icon: '🌐', className: 'website' },
    };

    return linkTypes[type] || { label: type, icon: '🔗', className: 'generic' };
}

// ============================================
// Helper to get commissions for current selection
// ============================================
function getCommissions(character, selectedVersion) {
    // If character has versions and a version is selected, get commissions from version
    if (character.versions && selectedVersion) {
        return selectedVersion.commissions || [];
    }
    // Fall back to character-level commissions (for characters without versions)
    return character.commissions || [];
}

// ============================================
// Helper to shuffle array (Fisher-Yates algorithm)
// ============================================
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// ============================================
// Shared download utility for reference sheets
// ============================================
async function downloadReferenceSheet(imageUrl, characterName, versionName = null, sheetIndex = 0, totalSheets = 1) {
    try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;

        // Generate filename
        const extension = imageUrl.split('.').pop().split('?')[0] || 'png';
        const versionSlug = versionName && versionName !== 'Default'
            ? `-${versionName.toLowerCase().replace(/\s+/g, '-')}`
            : '';
        const sheetNumber = totalSheets > 1 ? `-${sheetIndex + 1}` : '';
        const filename = `${characterName.toLowerCase().replace(/\s+/g, '-')}${versionSlug}${sheetNumber}-reference-sheet.${extension}`;

        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        return { success: true, filename };
    } catch (error) {
        // Fallback: open in new tab
        window.open(imageUrl, '_blank');
        return { success: false, error };
    }
}

// ============================================
// Character Button Component
// ============================================
function CharacterButton({ character, isSelected, onClick, lang = 'en' }) {
    const [isHovered, setIsHovered] = useState(false);

    const buttonStyle = {
        background: isSelected
            ? `linear-gradient(135deg, ${character.color}40, ${character.color}20)`
            : 'rgba(255,255,255,0.03)',
        borderColor: isSelected ? character.color : (isHovered ? `${character.color}80` : 'rgba(255,255,255,0.1)'),
        transform: isSelected ? 'scale(1.05)' : (isHovered ? 'scale(1.02)' : 'scale(1)'),
        boxShadow: isSelected
            ? `0 8px 32px ${character.color}30, inset 0 1px 0 rgba(255,255,255,0.1)`
            : '0 4px 16px rgba(0,0,0,0.2)',
    };

    return (
        <button
            className="character-btn"
            style={buttonStyle}
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div
                className="character-btn__indicator"
                style={{
                    background: character.color,
                    boxShadow: `0 0 12px ${character.color}80`
                }}
            />
            <div className="character-btn__name">{translateCharacterName(character.name, lang)}</div>
            <div className="character-btn__species">{translateSpecies(character.species, lang)}</div>
        </button>
    );
}

// ============================================
// Version Selector Component
// ============================================
function VersionSelector({ versions, selectedVersion, onSelectVersion, accentColor }) {
    if (!versions || versions.length <= 1) return null;
    
    return (
        <div className="version-selector">
            {versions.map((version) => {
                const commissionCount = version.commissions?.length || 0;
                return (
                    <button
                        key={version.id}
                        className={`version-btn ${selectedVersion.id === version.id ? 'version-btn--active' : ''}`}
                        style={{
                            borderColor: selectedVersion.id === version.id ? accentColor : undefined,
                            background: selectedVersion.id === version.id ? `${accentColor}20` : undefined,
                            color: selectedVersion.id === version.id ? accentColor : undefined,
                        }}
                        onClick={() => onSelectVersion(version)}
                    >
                        {version.name}
                        {commissionCount > 0 && (
                            <span style={{ 
                                marginLeft: '6px', 
                                opacity: 0.6,
                                fontSize: '0.75rem'
                            }}>
                                ({commissionCount})
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

// ============================================
// Social Links Component
// ============================================
function SocialLinks({ character }) {
    if (!character.links || character.links.length === 0) return null;

    return (
        <div className="social-links-container">
            <div className="social-links">
                {character.links.map((link, index) => {
                    const linkInfo = getLinkInfo(link.type);
                    return (
                        <a
                            key={index}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`social-link-btn social-link-btn--${linkInfo.className}`}
                            title={linkInfo.label}
                        >
                            <span className="social-link-icon">{linkInfo.icon}</span>
                            <span className="social-link-label">{linkInfo.label}</span>
                        </a>
                    );
                })}
            </div>
        </div>
    );
}

// ============================================
// Reference Sheet Component
// ============================================
function ReferenceSheet({ character, selectedVersion, onImageClick, currentIndex, onIndexChange, lang = 'en' }) {
    const [isHovered, setIsHovered] = useState(false);
    const t = translations[lang];

    // Get ref sheets array, supporting both old and new format
    const refSheets = selectedVersion?.refSheets
        || (selectedVersion?.refSheet ? [selectedVersion.refSheet] : null)
        || character.refSheets
        || (character.refSheet ? [character.refSheet] : []);
    const versionName = selectedVersion?.name;
    const currentRefSheet = refSheets[currentIndex] || refSheets[0];
    const hasMultipleSheets = refSheets.length > 1;

    const wrapperStyle = {
        boxShadow: isHovered
            ? `0 24px 70px rgba(0,0,0,0.6), 0 0 40px ${character.color}20`
            : '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)',
        transform: isHovered ? 'scale(1.01)' : 'scale(1)',
    };

    const handlePrevious = (e) => {
        e.stopPropagation();
        onIndexChange((currentIndex - 1 + refSheets.length) % refSheets.length);
    };

    const handleNext = (e) => {
        e.stopPropagation();
        onIndexChange((currentIndex + 1) % refSheets.length);
    };

    const handleDownload = async (e) => {
        e.stopPropagation();
        await downloadReferenceSheet(
            currentRefSheet,
            character.name,
            versionName,
            currentIndex,
            refSheets.length
        );
    };

    return (
        <div className="ref-sheet-container">
            <div
                className="ref-sheet-wrapper"
                style={wrapperStyle}
                onClick={() => onImageClick(currentRefSheet, null, true, versionName, refSheets, currentIndex)}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            >
                <img
                    className="ref-sheet-image"
                    src={currentRefSheet}
                    alt={`${character.name} ${versionName ? `(${versionName})` : ''} Reference Sheet`}
                />
                <div className="ref-sheet-overlay">
                    <h2 className="ref-sheet-name">{character.name}</h2>
                    {versionName && versionName !== 'Default' && (
                        <p className="ref-sheet-version">{versionName}</p>
                    )}
                    <p className="ref-sheet-label" style={{ color: character.color }}>
                        {t.officialRefSheet}
                    </p>
                </div>
                <div className="ref-sheet-hint">{t.clickToEnlarge}</div>

                {/* Quick download button */}
                <button
                    className="ref-sheet-download"
                    onClick={handleDownload}
                    aria-label={t.downloadRefSheet}
                    title={t.downloadRefSheet}
                >
                    <span className="ref-sheet-download__icon">⬇</span>
                </button>

                {/* Navigation buttons for multiple ref sheets */}
                {hasMultipleSheets && (
                    <>
                        <button
                            className="ref-sheet-nav ref-sheet-nav--prev"
                            onClick={handlePrevious}
                            aria-label={t.previousRefSheet}
                        >
                            ‹
                        </button>
                        <button
                            className="ref-sheet-nav ref-sheet-nav--next"
                            onClick={handleNext}
                            aria-label={t.nextRefSheet}
                        >
                            ›
                        </button>
                        <div className="ref-sheet-indicator">
                            {currentIndex + 1} / {refSheets.length}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ============================================
// Commission Card Component
// ============================================
function CommissionCard({ commission, character, index, onImageClick, lang = 'en' }) {
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
                alt={commission.title}
            />

            {/* Platform badge - visible on hover */}
            {platform && (
                <div className="commission-platform-badge">
                    <span className="commission-platform-icon">{platform.icon}</span>
                    <span className="commission-platform-label">{platform.type}</span>
                </div>
            )}

            <div className="commission-overlay">
                <h3 className="commission-title">{commission.title}</h3>
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

// ============================================
// Commissions Grid Component
// ============================================
function CommissionsGrid({ character, commissions, versionName, onImageClick, sortOrder, onSortChange, lang = 'en' }) {
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

// ============================================
// Lightbox Component
// ============================================
function Lightbox({ image, info, character, isRefSheet, versionName, onClose, currentIndex, onIndexChange, lang = 'en' }) {
    const t = translations[lang];
    const refSheets = isRefSheet && info?.refSheets ? info.refSheets : null;
    const hasMultipleSheets = refSheets && refSheets.length > 1;
    const [currentImage, setCurrentImage] = React.useState(image);
    const [currentIdx, setCurrentIdx] = React.useState(currentIndex || 0);

    React.useEffect(() => {
        setCurrentImage(image);
        setCurrentIdx(currentIndex || 0);
    }, [image, currentIndex]);

    // Use refs to avoid stale closures in event handlers
    const refSheetsRef = React.useRef(refSheets);
    const hasMultipleSheetsRef = React.useRef(hasMultipleSheets);
    const onIndexChangeRef = React.useRef(onIndexChange);

    React.useEffect(() => {
        refSheetsRef.current = refSheets;
        hasMultipleSheetsRef.current = hasMultipleSheets;
        onIndexChangeRef.current = onIndexChange;
    }, [refSheets, hasMultipleSheets, onIndexChange]);

    const handlePrevious = React.useCallback(() => {
        const sheets = refSheetsRef.current;
        if (hasMultipleSheetsRef.current && sheets) {
            setCurrentIdx(prevIdx => {
                const newIdx = (prevIdx - 1 + sheets.length) % sheets.length;
                setCurrentImage(sheets[newIdx]);
                if (onIndexChangeRef.current) onIndexChangeRef.current(newIdx);
                return newIdx;
            });
        }
    }, []);

    const handleNext = React.useCallback(() => {
        const sheets = refSheetsRef.current;
        if (hasMultipleSheetsRef.current && sheets) {
            setCurrentIdx(prevIdx => {
                const newIdx = (prevIdx + 1) % sheets.length;
                setCurrentImage(sheets[newIdx]);
                if (onIndexChangeRef.current) onIndexChangeRef.current(newIdx);
                return newIdx;
            });
        }
    }, []);

    useEffect(() => {
        const handleKeydown = (e) => {
            if (e.key === 'Escape') {
                onClose();
            } else if (hasMultipleSheetsRef.current && e.key === 'ArrowLeft') {
                handlePrevious();
            } else if (hasMultipleSheetsRef.current && e.key === 'ArrowRight') {
                handleNext();
            }
        };
        window.addEventListener('keydown', handleKeydown);
        return () => {
            window.removeEventListener('keydown', handleKeydown);
        };
    }, [onClose, handlePrevious, handleNext]);

    // Handle download (only for ref sheets)
    const handleDownload = async (e) => {
        e.stopPropagation();
        const sheets = refSheetsRef.current;
        await downloadReferenceSheet(
            currentImage,
            character.name,
            versionName,
            currentIdx,
            sheets?.length || 1
        );
    };

    // Handle opening source URL
    const handleViewSource = (e) => {
        e.stopPropagation();
        if (info?.sourceUrl) {
            window.open(info.sourceUrl, '_blank', 'noopener,noreferrer');
        }
    };

    // Get platform info for source button
    const platform = info?.sourceUrl ? getSourcePlatform(info.sourceUrl, lang) : null;

    return (
        <div className="lightbox" onClick={onClose}>
            <button className="lightbox__close" onClick={onClose}>✕</button>

            {/* Keyboard shortcuts hint */}
            <div className="lightbox__shortcuts-hint" aria-live="polite">
                {t.escToClose}
                {hasMultipleSheets && ` • ${t.arrowsToNavigate}`}
            </div>

            {/* Navigation buttons for multiple ref sheets */}
            {hasMultipleSheets && (
                <>
                    <button
                        className="lightbox__nav lightbox__nav--prev"
                        onClick={(e) => { e.stopPropagation(); handlePrevious(); }}
                        aria-label={t.previousRefSheet}
                    >
                        ‹
                    </button>
                    <button
                        className="lightbox__nav lightbox__nav--next"
                        onClick={(e) => { e.stopPropagation(); handleNext(); }}
                        aria-label={t.nextRefSheet}
                    >
                        ›
                    </button>
                </>
            )}

            <div className="lightbox__content" onClick={(e) => e.stopPropagation()}>
                <img
                    className="lightbox__image"
                    src={currentImage}
                    alt={info?.title || (isRefSheet ? `${character.name} Reference Sheet` : "Full size")}
                />

                {/* Info section */}
                <div className="lightbox__info">
                    {isRefSheet ? (
                        <>
                            <h3 className="lightbox__title">{character.name}</h3>
                            {versionName && versionName !== 'Default' && (
                                <p className="lightbox__version">{versionName}</p>
                            )}
                            <p className="lightbox__artist" style={{ color: character.color }}>
                                {t.officialRefSheet}
                                {hasMultipleSheets && ` (${currentIdx + 1}/${refSheets.length})`}
                            </p>
                        </>
                    ) : info && (
                        <>
                            <h3 className="lightbox__title">{info.title}</h3>
                            <p className="lightbox__artist" style={{ color: character.color }}>
                                {t.commissionedFrom} {info.artist}
                            </p>
                            {info.notes && (
                                <p className="lightbox__notes">"{info.notes}"</p>
                            )}
                        </>
                    )}
                </div>

                {/* Action Buttons */}
                <div className="lightbox__actions">
                    {/* Source button - only for commissions with sourceUrl */}
                    {!isRefSheet && platform && (
                        <button
                            className={`lightbox__btn lightbox__btn--${platform.type}`}
                            onClick={handleViewSource}
                        >
                            <span className="lightbox__btn-icon">{platform.icon}</span>
                            {platform.label}
                        </button>
                    )}

                    {/* Download button - only for reference sheets */}
                    {isRefSheet && (
                        <button
                            className="lightbox__btn lightbox__btn--download"
                            onClick={handleDownload}
                        >
                            <span className="lightbox__btn-icon">⬇️</span>
                            {t.downloadRefSheet}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ============================================
// Loading Component
// ============================================
function LoadingScreen({ lang = 'en' }) {
    const t = translations[lang];
    return (
        <div className="loading-container">
            <div className="loading-spinner"></div>
            <p className="loading-text">{t.loadingGallery}</p>
        </div>
    );
}

// ============================================
// Error Component
// ============================================
function ErrorScreen({ message, lang = 'en' }) {
    const t = translations[lang];
    return (
        <div className="error-container">
            <div className="error-icon">😕</div>
            <h2>{t.unableToLoad}</h2>
            <p className="error-message">{message}</p>
            <p className="error-message" style={{ marginTop: '20px' }}>
                {t.makeSureJSON} <code>characters.json</code> {t.existsAndValid}
            </p>
        </div>
    );
}

// ============================================
// Main Gallery Component
// ============================================
function CharacterGallery() {
    const [characters, setCharacters] = useState([]);
    const [selectedChar, setSelectedChar] = useState(null);
    const [selectedVersion, setSelectedVersion] = useState(null);
    const [showCommissions, setShowCommissions] = useState(false);
    const [lightboxImage, setLightboxImage] = useState(null);
    const [lightboxInfo, setLightboxInfo] = useState(null);
    const [lightboxIsRefSheet, setLightboxIsRefSheet] = useState(false);
    const [lightboxVersionName, setLightboxVersionName] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sortOrder, setSortOrder] = useState('random'); // 'random' or 'recency'
    const [refSheetIndex, setRefSheetIndex] = useState(0); // Index for multiple ref sheets
    const [lightboxRefSheetIndex, setLightboxRefSheetIndex] = useState(0); // Index for lightbox ref sheets
    const [language, setLanguage] = useState('en'); // 'en' or 'ja'

    // Get translations for current language
    const t = translations[language];

    // Helper function to read URL parameters
    const getUrlParams = () => {
        const params = new URLSearchParams(window.location.search);
        return {
            characterId: params.get('character'),
            versionId: params.get('version')
        };
    };

    // Load character data from JSON
    useEffect(() => {
        fetch('characters.json')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                setCharacters(data.characters);

                // Check for URL parameters
                const { characterId, versionId } = getUrlParams();

                if (characterId) {
                    // Find character by ID (numeric) or by slug (lowercase name)
                    const foundChar = data.characters.find(char =>
                        char.id.toString() === characterId ||
                        char.name.toLowerCase().replace(/\s+/g, '-') === characterId.toLowerCase()
                    );

                    if (foundChar) {
                        setSelectedChar(foundChar);
                        setShowCommissions(false);
                        setRefSheetIndex(0);

                        // Handle version selection
                        if (foundChar.versions && foundChar.versions.length > 0) {
                            if (versionId) {
                                // Find specific version
                                const foundVersion = foundChar.versions.find(v =>
                                    v.id === versionId ||
                                    v.name.toLowerCase().replace(/\s+/g, '-') === versionId.toLowerCase()
                                );
                                setSelectedVersion(foundVersion || foundChar.versions[0]);
                            } else {
                                // Default to first version
                                setSelectedVersion(foundChar.versions[0]);
                            }
                        } else {
                            setSelectedVersion(null);
                        }
                    }
                    // If character not found, fall through to normal behavior (no selection)
                }
                // If no URL params, don't select any character (existing behavior)

                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load characters:', err);
                setError(err.message);
                setLoading(false);
            });
    }, []);

    // Handle browser back/forward buttons
    useEffect(() => {
        const handlePopState = () => {
            const { characterId, versionId } = getUrlParams();

            if (!characterId) {
                // No character in URL - return to gallery home
                setSelectedChar(null);
                setSelectedVersion(null);
            } else if (characters.length > 0) {
                // Find and select character from URL
                const foundChar = characters.find(char =>
                    char.id.toString() === characterId ||
                    char.name.toLowerCase().replace(/\s+/g, '-') === characterId.toLowerCase()
                );

                if (foundChar) {
                    setSelectedChar(foundChar);
                    setShowCommissions(false);
                    setRefSheetIndex(0);

                    if (foundChar.versions && foundChar.versions.length > 0) {
                        if (versionId) {
                            const foundVersion = foundChar.versions.find(v =>
                                v.id === versionId ||
                                v.name.toLowerCase().replace(/\s+/g, '-') === versionId.toLowerCase()
                            );
                            setSelectedVersion(foundVersion || foundChar.versions[0]);
                        } else {
                            setSelectedVersion(foundChar.versions[0]);
                        }
                    }
                }
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [characters]); // Re-run when characters change

    // Handle character selection
    const handleSelectCharacter = (char) => {
        setSelectedChar(char);
        setShowCommissions(false);
        setRefSheetIndex(0); // Reset ref sheet index

        // Update URL parameter
        const characterSlug = char.name.toLowerCase().replace(/\s+/g, '-');
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('character', characterSlug);

        // Set default version for new character
        if (char.versions && char.versions.length > 0) {
            setSelectedVersion(char.versions[0]);
            const versionSlug = char.versions[0].id;
            newUrl.searchParams.set('version', versionSlug);
        } else {
            setSelectedVersion(null);
            newUrl.searchParams.delete('version');
        }

        // Update URL without page reload
        window.history.pushState({}, '', newUrl);
    };

    // Handle version selection
    const handleSelectVersion = (version) => {
        setSelectedVersion(version);
        setRefSheetIndex(0); // Reset ref sheet index
        // Reset to ref sheet view when changing versions
        setShowCommissions(false);

        // Update URL parameter to preserve version when sharing
        if (selectedChar) {
            const characterSlug = selectedChar.name.toLowerCase().replace(/\s+/g, '-');
            const versionSlug = version.id;
            const newUrl = new URL(window.location);
            newUrl.searchParams.set('character', characterSlug);
            newUrl.searchParams.set('version', versionSlug);
            window.history.pushState({}, '', newUrl);
        }
    };

    // Handle sort order change
    const handleSortChange = (newSortOrder) => {
        setSortOrder(newSortOrder);
    };

    const openLightbox = (image, info = null, isRefSheet = false, versionName = null, refSheets = null, currentIndex = 0) => {
        setLightboxImage(image);
        setLightboxInfo(info);
        setLightboxIsRefSheet(isRefSheet);
        setLightboxVersionName(versionName);
        setLightboxRefSheetIndex(currentIndex);
        // Store ref sheets array in info if it's a ref sheet
        if (isRefSheet && refSheets) {
            setLightboxInfo({ refSheets });
        }
    };

    const closeLightbox = () => {
        setLightboxImage(null);
        setLightboxInfo(null);
        setLightboxIsRefSheet(false);
        setLightboxVersionName(null);
    };

    if (loading) {
        return <LoadingScreen lang={language} />;
    }

    if (error) {
        return <ErrorScreen message={error} lang={language} />;
    }

    // Get character-specific data only if a character is selected
    const hasVersions = selectedChar?.versions && selectedChar.versions.length > 1;
    const currentCommissions = selectedChar ? getCommissions(selectedChar, selectedVersion) : [];
    const currentVersionName = selectedVersion?.name;

    // Check if reference sheet exists for current selection
    const hasRefSheet = selectedChar && (
        (selectedVersion?.refSheets && selectedVersion.refSheets.length > 0) ||
        selectedVersion?.refSheet ||
        (selectedChar.refSheets && selectedChar.refSheets.length > 0) ||
        selectedChar.refSheet
    );

    // Apply sorting to commissions
    const sortedCommissions = sortOrder === 'random'
        ? shuffleArray(currentCommissions)
        : [...currentCommissions].sort((a, b) => b.id - a.id); // Sort by recency (higher IDs first)

    return (
        <div className="gallery-container">
            {/* Decorative Background */}
            {selectedChar && (
                <div className="bg-decorations">
                    <div
                        className="bg-glow bg-glow--top"
                        style={{
                            background: `radial-gradient(circle, ${selectedChar.color}25 0%, transparent 70%)`
                        }}
                    />
                    <div
                        className="bg-glow bg-glow--bottom"
                        style={{
                            background: `radial-gradient(circle, ${selectedChar.color}15 0%, transparent 70%)`
                        }}
                    />
                </div>
            )}

            <div className="gallery-content">
                {/* Header */}
                <header className="gallery-header">
                    <h1 className="gallery-title">
                        {t.galleryTitle}
                    </h1>
                    {/* Language Switch Button */}
                    <button
                        className="lang-switch"
                        onClick={() => setLanguage(language === 'en' ? 'ja' : 'en')}
                        aria-label="Switch language"
                        title={language === 'en' ? 'Switch to Japanese' : 'Switch to English'}
                    >
                        {language === 'en' ? '日本語' : 'English'}
                    </button>
                </header>

                {/* Character Selector */}
                <nav className="character-nav">
                    {characters.map((char) => (
                        <CharacterButton
                            key={char.id}
                            character={char}
                            isSelected={selectedChar?.id === char.id}
                            onClick={() => handleSelectCharacter(char)}
                            lang={language}
                        />
                    ))}
                </nav>

                {/* Main Content */}
                {!selectedChar ? (
                    <div className="content-card">
                        <div className="character-select-prompt">
                            <p className="character-select-prompt__text">
                                {Array.isArray(t.selectCharacter) ? (
                                    <>
                                        {t.selectCharacter[0]}
                                        <br />
                                        {t.selectCharacter[1]}
                                    </>
                                ) : (
                                    t.selectCharacter
                                )}
                            </p>
                        </div>
                    </div>
                ) : (
                <div className="content-card">
                    {/* Version Selector - Always visible when versions exist */}
                    {hasVersions && (
                        <VersionSelector
                            versions={selectedChar.versions}
                            selectedVersion={selectedVersion}
                            onSelectVersion={handleSelectVersion}
                            accentColor={selectedChar.color}
                        />
                    )}

                    {/* Social Links */}
                    <SocialLinks character={selectedChar} />

                    {/* Toggle Button - only show if there's a reference sheet */}
                    {hasRefSheet && (
                        <div className="toggle-container">
                            <button
                                className="toggle-btn"
                                style={{
                                    background: showCommissions
                                        ? `linear-gradient(135deg, ${selectedChar.color}, ${selectedChar.color}cc)`
                                        : 'transparent',
                                    borderColor: selectedChar.color,
                                    color: showCommissions ? '#fff' : selectedChar.color,
                                    boxShadow: 'none',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.boxShadow = `0 8px 24px ${selectedChar.color}40`;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                                onClick={() => setShowCommissions(!showCommissions)}
                            >
                                <span className="toggle-btn__icon">
                                    {showCommissions ? '◀' : '▶'}
                                </span>
                                {showCommissions
                                    ? t.viewRefSheet
                                    : `${t.viewCommissions} (${currentCommissions.length})`
                                }
                            </button>
                        </div>
                    )}

                    {/* Reference Sheet or Commissions */}
                    {!showCommissions && hasRefSheet ? (
                        <ReferenceSheet
                            character={selectedChar}
                            selectedVersion={selectedVersion}
                            onImageClick={openLightbox}
                            currentIndex={refSheetIndex}
                            onIndexChange={setRefSheetIndex}
                            lang={language}
                        />
                    ) : (
                        <CommissionsGrid
                            character={selectedChar}
                            commissions={sortedCommissions}
                            versionName={currentVersionName}
                            onImageClick={openLightbox}
                            sortOrder={sortOrder}
                            onSortChange={handleSortChange}
                            lang={language}
                        />
                    )}
                </div>
                )}

                {/* Footer */}
                <footer className="gallery-footer">
                    <p className="social-links-disclaimer">{t.commissionTOS}</p>
                </footer>
            </div>

            {/* Lightbox */}
            {lightboxImage && (
                <Lightbox
                    image={lightboxImage}
                    info={lightboxInfo}
                    character={selectedChar}
                    isRefSheet={lightboxIsRefSheet}
                    versionName={lightboxVersionName}
                    onClose={closeLightbox}
                    currentIndex={lightboxRefSheetIndex}
                    onIndexChange={setLightboxRefSheetIndex}
                    lang={language}
                />
            )}
        </div>
    );
}

// ============================================
// Render the App
// ============================================
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<CharacterGallery />);
