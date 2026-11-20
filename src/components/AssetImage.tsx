import { ImageOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isZipBackupUrl, useResolvedAssetUrl } from '../services/assetSource';

interface AssetImageProps {
  src: string;
  alt: string;
  className?: string;
  fallbackLabel?: string;
  checkerboard?: boolean;
}

export function AssetImage({
  src,
  alt,
  className = 'w-full h-full object-contain',
  fallbackLabel,
  checkerboard = false,
}: AssetImageProps) {
  const resolvedSrc = useResolvedAssetUrl(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src, resolvedSrc]);

  const waitingForZip = Boolean(src && isZipBackupUrl(src) && !resolvedSrc);

  if (waitingForZip) {
    return (
      <div
        className={`animate-pulse bg-[#141824] ${checkerboard ? 'checkerboard-bg' : ''} ${className}`}
      />
    );
  }

  if (!resolvedSrc || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1.5 bg-[#11141C] text-[#6B7387] select-none ${
          checkerboard ? 'checkerboard-bg' : ''
        } ${className}`}
      >
        <ImageOff className="w-5 h-5 opacity-60" />
        {fallbackLabel && (
          <span className="text-[11px] font-mono px-2 text-center truncate max-w-full">
            {fallbackLabel}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
