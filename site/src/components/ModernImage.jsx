import { useState } from 'react';

/**
 * ModernImage Component
 *
 * Displays images using modern formats (WebP/AVIF) with automatic fallback to original format.
 * Supports lazy loading and provides loading states.
 *
 * @param {string} src - Original image path (e.g., /assets/commissions/character/@artist.png)
 * @param {string} alt - Alternative text for accessibility
 * @param {string} className - CSS class name
 * @param {Function} onClick - Click handler
 * @param {boolean} lazy - Enable lazy loading (default: true)
 * @param {string} loading - Loading attribute value ('lazy' or 'eager')
 */
export function ModernImage({
  src,
  alt = '',
  className = '',
  onClick = null,
  lazy = true,
  loading = 'lazy',
  ...props
}) {
  const [imageError, setImageError] = useState(false);

  if (!src) {
    return null;
  }

  // Skip modern formats for reference sheets (they're not converted) and GIFs (to preserve animation)
  const isReferenceSheet = src.includes('/referencesheets/');
  const isGif = src.toLowerCase().endsWith('.gif');

  // Generate modern format paths
  const getModernSrc = (originalSrc, format) => {
    if (isReferenceSheet || isGif) return null; // Don't try modern formats for ref sheets or GIFs
    const ext = originalSrc.match(/\.(png|jpg|jpeg)$/i);
    if (!ext) return null;
    return originalSrc.replace(ext[0], `.${format}`);
  };

  const webpSrc = getModernSrc(src, 'webp');
  const avifSrc = getModernSrc(src, 'avif');

  // Handle image loading errors
  const handleError = () => {
    setImageError(true);
  };

  // If modern formats failed, use original
  if (imageError) {
    return (
      <img
        src={src}
        alt={alt}
        className={className}
        onClick={onClick}
        loading={lazy ? loading : 'eager'}
        {...props}
      />
    );
  }

  // Use picture element for format fallback chain
  return (
    <picture>
      {/* AVIF - Best compression, newest format */}
      {avifSrc && (
        <source
          srcSet={avifSrc}
          type="image/avif"
        />
      )}

      {/* WebP - Good compression, wide support */}
      {webpSrc && (
        <source
          srcSet={webpSrc}
          type="image/webp"
        />
      )}

      {/* Original format fallback */}
      <img
        src={src}
        alt={alt}
        className={className}
        onClick={onClick}
        loading={lazy ? loading : 'eager'}
        onError={handleError}
        {...props}
      />
    </picture>
  );
}
