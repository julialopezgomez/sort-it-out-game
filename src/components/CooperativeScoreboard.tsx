import { useTranslation } from 'react-i18next';
import { cooperativeVerdict, groupSuccessPercent } from '../lib/scoring';

/**
 * The group against the game.
 *
 * Always shown next to the individual scores — it is not a mode anyone has to choose.
 * Every exactly-right position is a point for the group; every miss is a point for the game.
 */
export function CooperativeScoreboard({
  groupPoints,
  gamePoints,
  possiblePoints,
  turnGroupPoints,
  turnGamePoints,
  final = false,
}: {
  groupPoints: number;
  gamePoints: number;
  possiblePoints: number;
  turnGroupPoints?: number;
  turnGamePoints?: number;
  final?: boolean;
}) {
  const { t } = useTranslation();
  const verdict = cooperativeVerdict(groupPoints, gamePoints);
  const percent = groupSuccessPercent(groupPoints, possiblePoints);

  const verdictLabel = final
    ? t(
        verdict === 'group'
          ? 'coop.finalGroup'
          : verdict === 'draw'
            ? 'coop.finalDraw'
            : 'coop.finalGame',
      )
    : t(
        verdict === 'group'
          ? 'coop.verdictGroup'
          : verdict === 'draw'
            ? 'coop.verdictDraw'
            : 'coop.verdictGame',
      );

  // Guard against a zero denominator before any turn has been scored.
  const groupShare = possiblePoints > 0 ? (groupPoints / possiblePoints) * 100 : 50;

  return (
    <section className="card p-4" aria-labelledby="coop-heading">
      <h3 id="coop-heading" className="text-base font-semibold">
        {t('coop.title')}
      </h3>
      <p className="help">{t('coop.explain')}</p>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Score label={t('coop.groupPoints')} value={groupPoints} tone="teal" />
        <Score label={t('coop.gamePoints')} value={gamePoints} tone="coral" />
      </div>

      {/* A proportional bar, with the numbers always present in text as well. */}
      <div
        className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-line"
        role="img"
        aria-label={`${t('coop.groupPoints')} ${groupPoints}, ${t('coop.gamePoints')} ${gamePoints}`}
      >
        <div className="bg-teal-400" style={{ width: `${groupShare}%` }} />
        <div className="flex-1 bg-coral-500" />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        {turnGroupPoints !== undefined && turnGamePoints !== undefined && (
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-ink-faint">{t('coop.thisTurn')}</dt>
            <dd className="tabular-nums font-medium">
              {turnGroupPoints} / {turnGamePoints}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-ink-faint">{t('coop.possible')}</dt>
          <dd className="tabular-nums font-medium">{possiblePoints}</dd>
        </div>
        <div>
          <dt className="text-ink-faint">{t('coop.successRate')}</dt>
          <dd className="tabular-nums font-medium">
            {percent === null ? t('common.notAvailable') : `${percent.toFixed(2)}%`}
          </dd>
        </div>
      </dl>

      <p
        className={`mt-3 rounded-xl px-3 py-2 text-sm font-medium ${
          verdict === 'group'
            ? 'bg-teal-50 text-teal-700'
            : verdict === 'draw'
              ? 'bg-sunny-50 text-sunny-700'
              : 'bg-coral-50 text-coral-700'
        }`}
      >
        {verdictLabel}
      </p>
    </section>
  );
}

function Score({ label, value, tone }: { label: string; value: number; tone: 'teal' | 'coral' }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${tone === 'teal' ? 'bg-teal-50' : 'bg-coral-50'}`}>
      <div
        className={`text-xs font-medium ${tone === 'teal' ? 'text-teal-700' : 'text-coral-700'}`}
      >
        {label}
      </div>
      <div className="tabular-nums text-2xl font-semibold text-ink">{value}</div>
    </div>
  );
}
