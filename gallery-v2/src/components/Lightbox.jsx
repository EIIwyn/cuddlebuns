import { useState, useEffect, useRef, useCallback } from 'react';
import { translations, getSourcePlatform, downloadReferenceSheet } from '../translations';

export function Lightbox({ image, info, character, isRefSheet, versionName, onClose, currentIndex, onIndexChange, lang = 'en' }) {
    const t = translations[lang];
    const refSheets = isRefSheet && info?.refSheets ? info.refSheets : null;
    const hasMultipleSheets = refSheets && refSheets.length > 1;
    const [currentImage, setCurrentImage] = useState(image);
    const [currentIdx, setCurrentIdx] = useState(currentIndex || 0);

    useEffect(() => {
        setCurrentImage(image);
        setCurrentIdx(currentIndex || 0);
    }, [image, currentIndex]);

    // Use refs to avoid stale closures in event handlers
    const refSheetsRef = useRef(refSheets);
    const hasMultipleSheetsRef = useRef(hasMultipleSheets);
    const onIndexChangeRef = useRef(onIndexChange);

    useEffect(() => {
        refSheetsRef.current = refSheets;
        hasMultipleSheetsRef.current = hasMultipleSheets;
        onIndexChangeRef.current = onIndexChange;
    }, [refSheets, hasMultipleSheets, onIndexChange]);

    const handlePrevious = useCallback(() => {
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

    const handleNext = useCallback(() => {
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
                            <h3 className="lightbox__title">{info.title || 'Commission'}</h3>
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
