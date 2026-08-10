import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shell } from '../components/Shell';
import { forgetMembership, readMembership } from '../lib/session';
import { formatRoomCode } from '../lib/roomCode';
import { loadHistory } from '../lib/localHistory';
import { PLAYER_MAX, PLAYER_MIN } from '../lib/types';

export function LandingScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const membership = readMembership();
  const hasHistory = loadHistory().length > 0;

  return (
    <Shell>
      <div className="space-y-6">
        <header className="text-center">
          <h1 className="text-3xl sm:text-4xl">{t('app.name')}</h1>
          <p className="mt-1 text-lg text-teal-700">{t('app.tagline')}</p>
          <p className="mx-auto mt-3 max-w-prose text-ink-soft">{t('app.description')}</p>
          <p className="mt-2 text-sm text-ink-faint">
            {t('landing.playersSupported')} · {t('landing.freeForever')}
          </p>
        </header>

        {membership && (
          <section className="card border-teal-400 bg-teal-50 p-4">
            <p className="text-sm font-medium">
              {t('landing.rejoinPrompt', {
                code: formatRoomCode(membership.roomCode),
                name: membership.displayName,
              })}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => navigate(`/room/${membership.roomCode}`)}
              >
                {t('landing.rejoin')}
              </button>
              <button
                type="button"
                className="btn-quiet btn-sm"
                onClick={() => {
                  forgetMembership();
                  navigate('/', { replace: true });
                  window.location.reload();
                }}
              >
                {t('landing.noThanks')}
              </button>
            </div>
          </section>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <section className="card flex flex-col p-5">
            <h2 className="text-lg">{t('landing.createGame')}</h2>
            <p className="help flex-1">{t('landing.createHint')}</p>
            <Link to="/create" className="btn-primary mt-4">
              {t('landing.createGame')}
            </Link>
          </section>

          <section className="card flex flex-col p-5">
            <h2 className="text-lg">{t('landing.joinGame')}</h2>
            <p className="help flex-1">{t('landing.joinHint')}</p>
            <Link to="/join" className="btn-secondary mt-4">
              {t('landing.joinGame')}
            </Link>
          </section>
        </div>

        <section className="card p-5">
          <h2 className="text-lg">{t('landing.howItWorks')}</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-ink-soft">
            <li>{t('landing.howStep1')}</li>
            <li>{t('landing.howStep2')}</li>
            <li>{t('landing.howStep3')}</li>
            <li>{t('landing.howStep4')}</li>
          </ol>
          <p className="mt-3 rounded-xl bg-bluish-50 px-3 py-2 text-sm text-bluish-700">
            {t('rules.roundMeaning')}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/rules" className="btn-secondary btn-sm">
              {t('landing.readRules')}
            </Link>
            {hasHistory && (
              <Link to="/history" className="btn-quiet btn-sm">
                {t('landing.viewHistory')}
              </Link>
            )}
          </div>
        </section>

        <p className="text-center text-xs text-ink-faint">
          {PLAYER_MIN}–{PLAYER_MAX} {t('common.players').toLowerCase()}
        </p>
      </div>
    </Shell>
  );
}
