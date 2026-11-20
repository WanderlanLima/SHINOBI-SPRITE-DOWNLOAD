import { ImageOff } from 'lucide-react';
import { useState } from 'react';

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
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
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
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
