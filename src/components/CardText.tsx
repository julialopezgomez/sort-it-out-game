import { useTranslation } from 'react-i18next';
import type { CardView } from '../lib/schemas';

/**
 * A concept, in the reader's language where possible.
 *
 * Custom cards may exist in only one language, because the group typed them and nothing
 * here calls a translation service. When that happens the available text is shown with a
 * discreet note saying which language it is in, rather than hiding the card.
 *
 * Player-authored text is rendered as text. It is never inserted as HTML.
 */
export function CardText({ card, className = '' }: { card: CardView; className?: string }) {
  const { t } = useTranslation();
  const isFallback = card.shownLanguage !== card.requestedLanguage;

  return (
    <span className={`min-w-0 ${className}`}>
      <span className="break-words text-base text-ink">{card.text}</span>
      {isFallback && (
        <span
          className="chip ml-2 whitespace-nowrap bg-sunny-50 text-sunny-700"
          title={t('order.fallbackExplain')}
        >
          {card.shownLanguage === 'en' ? t('order.shownInEnglish') : t('order.shownInSpanish')}
        </span>
      )}
    </span>
  );
}
