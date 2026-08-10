import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { clampTimeLimit, formatLimit } from '../lib/time';
import { TIME_LIMIT_MAX_SECONDS } from '../lib/types';

/**
 * A time limit: preset buttons plus +30s / +1min for anything in between.
 *
 * `null` means unlimited, and it stays null all the way to the database — no far-off fake
 * deadline is invented anywhere in this codebase.
 */
export function TimeLimitPicker({
  label,
  help,
  value,
  presets,
  onChange,
  disabled = false,
}: {
  label: string;
  help?: string;
  value: number | null;
  presets: readonly (number | null)[];
  onChange: (seconds: number | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const groupId = useId();
  const isPreset = presets.includes(value);

  return (
    <fieldset disabled={disabled}>
      <legend className="label" id={groupId}>
        {label}
      </legend>

      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby={groupId}>
        {presets.map((preset) => (
          <button
            key={preset === null ? 'unlimited' : preset}
            type="button"
            onClick={() => onChange(preset)}
            aria-pressed={value === preset}
            className={`btn btn-sm ${
              value === preset
                ? 'bg-teal-600 text-white'
                : 'border border-line bg-surface text-ink hover:bg-teal-50'
            }`}
          >
            {preset === null ? t('common.unlimited') : formatLimit(preset, t('common.unlimited'))}
          </button>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={value !== null && value >= TIME_LIMIT_MAX_SECONDS}
          onClick={() => onChange(clampTimeLimit((value ?? 0) + 30))}
        >
          {t('create.addThirty')}
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={value !== null && value >= TIME_LIMIT_MAX_SECONDS}
          onClick={() => onChange(clampTimeLimit((value ?? 0) + 60))}
        >
          {t('create.addMinute')}
        </button>

        {!isPreset && value !== null && (
          <span className="chip bg-sunny-50 text-sunny-700">
            {t('create.customTime', { value: formatLimit(value, t('common.unlimited')) })}
          </span>
        )}
      </div>

      {help && <p className="help">{help}</p>}
    </fieldset>
  );
}
