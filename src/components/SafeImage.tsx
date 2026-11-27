import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';

interface SafeImageProps {
  src: string;
  alt: string;
  className?: string;
  fallbackLabel?: string;
}

function resolveSafeImageSrc(rawSrc: string): string {
  const trimmed = rawSrc.trim();
  if (!trimmed) return '';
  if (/^(javascript|vbscript|data:text\/html):/i.test(trimmed)) {
    return '';
  }
  if (trimmed.startsWith('/src/assets/')) {
    const base = import.meta.env.BASE_URL || '/';
    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    return `${normalizedBase}${trimmed.slice(1)}`;
  }
  return trimmed;
}

export function SafeImage({
  src,
  alt,
  className = '',
  fallbackLabel,
}: SafeImageProps) {
  const resolvedSrc = resolveSafeImageSrc(src);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [resolvedSrc]);

  if (hasError || !resolvedSrc) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-slate-100 text-slate-400 p-4 text-center ${className}`}
        role="img"
        aria-label={alt}
      >
        <Package className="w-8 h-8 mb-2 stroke-[1.5]" aria-hidden="true" />
        <span className="text-xs font-medium text-slate-500 line-clamp-2 max-w-[180px]">
          {fallbackLabel || alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={className}
    />
  );
}
