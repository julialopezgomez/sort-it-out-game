import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Copy to clipboard, with a fallback for browsers that refuse the async clipboard API. */
export function CopyButton({
  value,
  label,
  className = 'btn-secondary btn-sm',
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Older browsers, or an insecure context: fall back to a hidden textarea.
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', 'true');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy');
      } catch {
        /* nothing else to try; the value is on screen to copy by hand */
      }
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button type="button" className={className} onClick={() => void copy()}>
      <span aria-hidden="true">{copied ? '✓' : '⧉'}</span>
      {copied ? t('common.copied') : label}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? t('common.copied') : ''}
      </span>
    </button>
  );
}
