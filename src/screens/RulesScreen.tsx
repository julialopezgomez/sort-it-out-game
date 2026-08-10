import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shell } from '../components/Shell';

export function RulesScreen() {
  const { t } = useTranslation();

  return (
    <Shell>
      <div className="space-y-6">
        <h1 className="text-2xl">{t('rules.title')}</h1>

        <section>
          <h2 className="text-lg">{t('rules.goal')}</h2>
          <p className="mt-1 text-ink-soft">{t('rules.goalBody')}</p>
        </section>

        <section>
          <h2 className="text-lg">{t('rules.words')}</h2>
          <dl className="mt-2 space-y-2">
            {(
              [
                'wordGame',
                'wordCycle',
                'wordTurn',
                'wordRanker',
                'wordGuesser',
                'wordHost',
              ] as const
            ).map((key) => (
              <dd key={key} className="text-ink-soft">
                {t(`rules.${key}`)}
              </dd>
            ))}
          </dl>
          <p className="mt-2 rounded-xl bg-bluish-50 px-3 py-2 text-sm text-bluish-700">
            {t('rules.roundMeaning')}
          </p>
        </section>

        <section>
          <h2 className="text-lg">{t('rules.flow')}</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-ink-soft">
            {(['flow1', 'flow2', 'flow3', 'flow4', 'flow5'] as const).map((key) => (
              <li key={key}>{t(`rules.${key}`)}</li>
            ))}
          </ol>
        </section>

        <section>
          <h2 className="text-lg">{t('rules.scoring')}</h2>
          <p className="mt-1 text-ink-soft">{t('rules.scoringBody')}</p>
        </section>

        <section>
          <h2 className="text-lg">{t('rules.coop')}</h2>
          <p className="mt-1 text-ink-soft">{t('rules.coopBody')}</p>
        </section>

        <section>
          <h2 className="text-lg">{t('rules.skipping')}</h2>
          <p className="mt-1 text-ink-soft">{t('rules.skippingBody')}</p>
        </section>

        <section>
          <h2 className="text-lg">{t('rules.joining')}</h2>
          <p className="mt-1 text-ink-soft">{t('rules.joiningBody')}</p>
        </section>

        <section>
          <h2 className="text-lg">{t('rules.disconnecting')}</h2>
          <p className="mt-1 text-ink-soft">{t('rules.disconnectingBody')}</p>
        </section>

        <section className="card border-dashed bg-canvas p-4">
          <h2 className="text-lg">{t('rules.privacy')}</h2>
          <p className="mt-1 text-ink-soft">{t('rules.privacyBody')}</p>
        </section>

        <Link to="/" className="btn-quiet btn-sm">
          {t('common.back')}
        </Link>
      </div>
    </Shell>
  );
}
