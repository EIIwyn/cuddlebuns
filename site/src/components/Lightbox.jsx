import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadReferenceSheet, getSourcePlatform, translations } from '../translations';
import { ModernImage } from './ModernImage';

export function Lightbox({
  image,
  info,
  character,
  isRefSheet,
  versionName,
  onClose,
  currentIndex,
  onIndexChange,
  lang = 'en',
}) {
  const t = translations[lang];
  const refSheets = isRefSheet && info?.refSheets ? info.refSheets : null;
  const hasMultipleSheets = Boolean(refSheets && refSheets.length > 1);
  const [currentImage, setCurrentImage] = useState(image);
  const [currentIdx, setCurrentIdx] = useState(currentIndex || 0);
  const refSheetsRef = useRef(refSheets);
  const onIndexChangeRef = useRef(onIndexChange);

  useEffect(() => {
    // Syncing lightbox state to a newly selected image is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentImage(image);
    setCurrentIdx(currentIndex || 0);
  }, [image, currentIndex]);

  useEffect(() => {
    refSheetsRef.current = refSheets;
    onIndexChangeRef.current = onIndexChange;
  }, [refSheets, onIndexChange]);

  const move = useCallback((direction) => {
    const sheets = refSheetsRef.current;
    if (!sheets || sheets.length < 2) return;
    setCurrentIdx((previousIndex) => {
      const nextIndex = (previousIndex + direction + sheets.length) % sheets.length;
      setCurrentImage(sheets[nextIndex]);
      onIndexChangeRef.current?.(nextIndex);
      return nextIndex;
    });
  }, []);

  useEffect(() => {
    const handleKeydown = (event) => {
      if (event.key === 'Escape') onClose();
      if (hasMultipleSheets && event.key === 'ArrowLeft') move(-1);
      if (hasMultipleSheets && event.key === 'ArrowRight') move(1);
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [hasMultipleSheets, move, onClose]);

  const platform = info?.sourceUrl ? getSourcePlatform(info.sourceUrl, lang) : null;
  const downloadableImage = currentImage?.originalUrl || currentImage?.fallback?.url || currentImage;

  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <button className="lightbox__close" onClick={onClose} aria-label="Close image">×</button>
      {hasMultipleSheets && (
        <>
          <button
            className="lightbox__nav lightbox__nav--prev"
            onClick={(event) => { event.stopPropagation(); move(-1); }}
            aria-label={t.previousRefSheet}
          >
            ←
          </button>
          <button
            className="lightbox__nav lightbox__nav--next"
            onClick={(event) => { event.stopPropagation(); move(1); }}
            aria-label={t.nextRefSheet}
          >
            →
          </button>
        </>
      )}

      <div className="lightbox__content" onClick={(event) => event.stopPropagation()}>
        {isRefSheet && currentImage?.originalUrl ? (
          <img
            className="lightbox__image"
            src={currentImage.originalUrl}
            alt={`${character.name} reference sheet`}
            loading="eager"
            decoding="async"
          />
        ) : (
          <ModernImage
            className="lightbox__image"
            src={currentImage?.originalUrl || currentImage}
            alt={info?.title || (isRefSheet ? `${character.name} reference sheet` : 'Full-size artwork')}
            loading="eager"
            lazy={false}
            sizes="100vw"
          />
        )}

        <footer className="lightbox__footer">
          <div>
            <p className="lightbox__kicker">{isRefSheet ? 'Reference' : info?.type || 'Artwork'}</p>
            <h2>{isRefSheet ? character.name : info?.artist}</h2>
            {isRefSheet && (
              <p>
                {versionName}
                {hasMultipleSheets ? ` · ${currentIdx + 1} of ${refSheets.length}` : ''}
              </p>
            )}
          </div>
          <div className="lightbox__actions">
            {!isRefSheet && platform && (
              <a href={info.sourceUrl} target="_blank" rel="noreferrer">
                {platform.label} ↗
              </a>
            )}
            {isRefSheet && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  downloadReferenceSheet(
                    downloadableImage,
                    character.name,
                    versionName,
                    currentIdx,
                    refSheets?.length || 1,
                  );
                }}
              >
                Download ↓
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
