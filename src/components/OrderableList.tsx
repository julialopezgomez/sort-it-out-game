import { useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import type { CardView } from '../lib/schemas';
import { CardText } from './CardText';

/**
 * The ranking list.
 *
 * Drag and drop is the fast path, but it is never the only path: every row also carries
 * Move up and Move down buttons, and the whole list is operable from the keyboard through
 * dnd-kit's keyboard sensor. Position changes are announced through dnd-kit's live region.
 */

export type OrderableListProps = {
  items: CardView[];
  onChange: (nextOrder: string[]) => void;
  disabled?: boolean;
};

export function OrderableList({ items, onChange, disabled = false }: OrderableListProps) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // A small threshold so a tap on a Move button is never read as a drag.
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = useMemo(() => items.map((item) => item.canonicalId), [items]);

  const labelFor = (id: string): string =>
    items.find((item) => item.canonicalId === id)?.text ?? id;

  const move = (from: number, to: number) => {
    if (disabled) return;
    if (to < 0 || to >= items.length || from === to) return;
    onChange(arrayMove(ids, from, to));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onChange(arrayMove(ids, from, to));
  };

  const screenReaderInstructions: ScreenReaderInstructions = {
    draggable: t('a11y.orderingInstructions'),
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t('order.pickedUpAnnouncement', { item: labelFor(String(active.id)) }),
    onDragOver: ({ active, over }) =>
      over
        ? t('order.movedAnnouncement', {
            item: labelFor(String(active.id)),
            position: ids.indexOf(String(over.id)) + 1,
          })
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? t('order.droppedAnnouncement', {
            item: labelFor(String(active.id)),
            position: ids.indexOf(String(over.id)) + 1,
          })
        : undefined,
    onDragCancel: ({ active }) =>
      t('order.movedAnnouncement', {
        item: labelFor(String(active.id)),
        position: ids.indexOf(String(active.id)) + 1,
      }),
  };

  return (
    <div>
      <p className="sr-only" id="ordering-instructions">
        {t('a11y.orderingInstructions')}
      </p>

      <div className="mb-2 flex items-center justify-between text-sm font-medium text-teal-700">
        <span>{t('order.best')}</span>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        accessibility={{ screenReaderInstructions, announcements }}
        onDragStart={(event) => setActiveId(String(event.active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2" aria-describedby="ordering-instructions">
            {items.map((item, index) => (
              <SortableRow
                key={item.canonicalId}
                item={item}
                index={index}
                total={items.length}
                disabled={disabled}
                isActive={activeId === item.canonicalId}
                onMoveUp={() => move(index, index - 1)}
                onMoveDown={() => move(index, index + 1)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      <div className="mt-2 flex items-center justify-between text-sm font-medium text-coral-700">
        <span>{t('order.worst')}</span>
      </div>
    </div>
  );
}

type SortableRowProps = {
  item: CardView;
  index: number;
  total: number;
  disabled: boolean;
  isActive: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
};

function SortableRow({
  item,
  index,
  total,
  disabled,
  isActive,
  onMoveUp,
  onMoveDown,
}: SortableRowProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.canonicalId,
    disabled,
  });

  const label = item.text ?? item.canonicalId;
  const position = index + 1;

  return (
    <li
      ref={setNodeRef}
      data-card-id={item.canonicalId}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`card flex items-stretch gap-2 p-2 ${isDragging || isActive ? 'dragging' : ''}`}
    >
      {/* The drag handle is also the keyboard entry point into reordering. */}
      <button
        type="button"
        className="btn-quiet min-h-touch shrink-0 cursor-grab touch-none px-2 active:cursor-grabbing"
        aria-label={t('order.dragHandleLabel', { item: label, position })}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <span aria-hidden="true" className="text-lg leading-none text-ink-faint">
          ⠿
        </span>
      </button>

      <span
        aria-hidden="true"
        className="flex w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-base font-semibold text-teal-700"
      >
        {position}
      </span>

      <div className="flex min-w-0 flex-1 items-center py-1">
        <CardText card={item} />
      </div>

      <div className="flex shrink-0 flex-col justify-center gap-1">
        <button
          type="button"
          className="btn-secondary btn-sm min-h-[2rem] px-2"
          onClick={onMoveUp}
          disabled={disabled || index === 0}
          aria-label={t('order.moveUpLabel', { item: label, position: position - 1 })}
        >
          <span aria-hidden="true">↑</span>
          <span className="sr-only">{t('order.moveUp')}</span>
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm min-h-[2rem] px-2"
          onClick={onMoveDown}
          disabled={disabled || index === total - 1}
          aria-label={t('order.moveDownLabel', { item: label, position: position + 1 })}
        >
          <span aria-hidden="true">↓</span>
          <span className="sr-only">{t('order.moveDown')}</span>
        </button>
      </div>
    </li>
  );
}
