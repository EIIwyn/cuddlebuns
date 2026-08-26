import { useState } from 'react';

/** Renders a generated responsive image descriptor, with string-path fallback support. */
export function ModernImage({
  src,
  alt = '',
  className = '',
  onClick = null,
  lazy = true,
  loading = 'lazy',
  sizes = '(max-width: 640px) 50vw, (max-width: 1100px) 33vw, 25vw',
  ...props
}) {
  const [failedSource, setFailedSource] = useState(null);

  if (!src) return null;

  const responsiveImage = typeof src === 'object' ? src : null;
  const fallbackSrc = responsiveImage?.fallback?.url || src;
  const imageError = failedSource === fallbackSrc;
  const isReferenceSheet = typeof fallbackSrc === 'string' && fallbackSrc.includes('/referencesheets/');
  const isGif = typeof fallbackSrc === 'string' && fallbackSrc.toLowerCase().endsWith('.gif');
  const getModernSrc = (originalSrc, format) => {
    if (isReferenceSheet || isGif || typeof originalSrc !== 'string') return null;
    const extension = originalSrc.match(/\.(png|jpg|jpeg)$/i);
    return extension ? originalSrc.replace(extension[0], `.${format}`) : null;
  };
  const responsiveSrcSet = (format) => responsiveImage?.sources?.[format]
    ?.map((source) => `${source.url} ${source.width}w`)
    .join(', ');
  const imageProps = {
    src: fallbackSrc,
    alt,
    className,
    onClick,
    loading: lazy ? loading : 'eager',
    decoding: 'async',
    width: responsiveImage?.fallback?.width || responsiveImage?.width,
    height: responsiveImage?.fallback?.height || responsiveImage?.height,
    ...props,
  };

  if (imageError) return <img {...imageProps} />;

  const avifSrc = responsiveSrcSet('avif') || getModernSrc(src, 'avif');
  const webpSrc = responsiveSrcSet('webp') || getModernSrc(src, 'webp');
  return (
    <picture>
      {avifSrc && <source srcSet={avifSrc} sizes={responsiveImage ? sizes : undefined} type="image/avif" />}
      {webpSrc && <source srcSet={webpSrc} sizes={responsiveImage ? sizes : undefined} type="image/webp" />}
      <img {...imageProps} onError={() => setFailedSource(fallbackSrc)} />
    </picture>
  );
}
