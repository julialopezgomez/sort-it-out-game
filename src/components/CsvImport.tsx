import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { exampleCsv, parseDictionaryCsv, type CsvParseResult } from '../lib/csv';
import { normalizeCustomCards, type DedupeResult } from '../lib/normalize';
import { downloadTextFile } from '../lib/download';

/**
 * CSV import with a preview.
 *
 * The file is read here in the browser with FileReader; it is never uploaded anywhere
 * except, once confirmed, into this game's own rows in Supabase. Bad rows are reported
 * individually and the good ones still go through — a single stray comma should not cost
 * somebody their whole word list.
 */
export function CsvImport({
  existingKeys = [],
  onImport,
  busy = false,
}: {
  existingKeys?: string[];
  onImport: (cards: { en: string | null; es: string | null }[]) => void | Promise<void>;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [deduped, setDeduped] = useState<DedupeResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const result = parseDictionaryCsv(text);
      setParsed(result);
      setDeduped(normalizeCustomCards(result.rows, existingKeys));
      setFileName(file.name);
    };
    // Read as UTF-8; the parser strips a BOM if the spreadsheet added one.
    reader.readAsText(file, 'utf-8');
  };

  const reset = () => {
    setParsed(null);
    setDeduped(null);
    setFileName(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const validCount = deduped?.cards.length ?? 0;
  const duplicateCount = deduped?.duplicates.length ?? 0;
  const errorRows = [
    ...(parsed?.errors ?? []).map((error) => ({
      line: error.line,
      message: t(`csv.error${error.code}`),
      raw: error.raw,
    })),
    ...(deduped?.invalid ?? []).map((entry) => ({
      line: entry.row.line ?? 0,
      message: entry.reason === 'empty' ? t('csv.errorBOTH_EMPTY') : t('csv.errorTOO_LONG'),
      raw: `${entry.row.en ?? ''},${entry.row.es ?? ''}`,
    })),
  ].sort((a, b) => a.line - b.line);

  return (
    <div className="space-y-3">
      <p className="help">{t('csv.intro')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={inputId} className="btn-secondary cursor-pointer">
          {t('csv.chooseFile')}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <button
          type="button"
          className="btn-quiet btn-sm"
          onClick={() => downloadTextFile('sort-it-out-example.csv', exampleCsv())}
        >
          {t('csv.downloadExample')}
        </button>
      </div>

      <p className="text-xs text-ink-faint">{t('csv.privacyNote')}</p>

      {parsed && deduped && (
        <section className="card p-4" aria-live="polite">
          <h3 className="text-base">{t('csv.previewTitle')}</h3>
          {fileName && <p className="text-xs text-ink-faint">{fileName}</p>}
          <p className="mt-1 text-sm text-ink-soft">
            {t('csv.summary', {
              valid: validCount,
              duplicates: duplicateCount,
              errors: errorRows.length,
            })}
          </p>

          {validCount > 0 && (
            <details className="mt-3" open>
              <summary className="cursor-pointer text-sm font-medium">
                {t('csv.willImport')} ({validCount})
              </summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
                {deduped.cards.map((card, index) => (
                  <li key={`${card.key}-${index}`} className="flex flex-wrap gap-x-2 text-ink-soft">
                    <span className="text-ink">{card.en ?? '—'}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-ink">{card.es ?? '—'}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {duplicateCount > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium">
                {t('csv.duplicatesTitle')} ({duplicateCount})
              </summary>
              <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-sm text-ink-faint">
                {deduped.duplicates.map((row, index) => (
                  <li key={index}>
                    {row.en ?? '—'} · {row.es ?? '—'}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {errorRows.length > 0 && (
            <details className="mt-3" open>
              <summary className="cursor-pointer text-sm font-medium text-coral-700">
                {t('csv.errorsTitle')} ({errorRows.length})
              </summary>
              <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto text-sm">
                {errorRows.map((row, index) => (
                  <li key={index} className="rounded-lg bg-coral-50 px-2 py-1">
                    <span className="font-medium text-coral-700">
                      {t('csv.rowLine', { line: row.line })}
                    </span>{' '}
                    <span className="text-ink-soft">{row.message}</span>
                    {row.raw && (
                      <code className="ml-1 break-all text-xs text-ink-faint">{row.raw}</code>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={validCount === 0 || busy}
              onClick={() => {
                void onImport(deduped.cards.map((card) => ({ en: card.en, es: card.es })));
                reset();
              }}
            >
              {validCount === 0
                ? t('csv.nothingToImport')
                : t('csv.confirmImport', { count: validCount })}
            </button>
            <button type="button" className="btn-secondary" onClick={reset}>
              {t('common.cancel')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
