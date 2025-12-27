import { useState } from 'react';
import { translations, downloadReferenceSheet } from '../translations';

export function ReferenceSheet({ character, selectedVersion, onImageClick, currentIndex, onIndexChange, lang = 'en' }) {
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
