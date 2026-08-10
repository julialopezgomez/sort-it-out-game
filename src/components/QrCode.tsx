import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * A QR code for the join link, generated locally.
 *
 * No image service, no network request: the `qrcode` package renders straight to an SVG
 * string here in the browser, which also means the room code never leaves the page.
 */
export function QrCode({ value, alt, size = 176 }: { value: string; alt: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void QRCode.toString(value, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#26292E', light: '#FFFFFF' },
    })
      .then((svg) => {
        if (cancelled) return;
        setDataUrl(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
      })
      .catch(() => {
        // A missing QR code is a cosmetic loss; the room code and link still work.
        if (!cancelled) setDataUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!dataUrl) {
    return (
      <div
        className="rounded-xl border border-line bg-canvas"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      src={dataUrl}
      alt={alt}
      width={size}
      height={size}
      className="rounded-xl border border-line bg-white p-2"
    />
  );
}
