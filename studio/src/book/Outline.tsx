import { useLocale } from '../i18n/LocaleProvider';
import { Icon, type IconName } from '../shell/Icon';
import { useBook } from './BookProvider';

/* The outline: the open book's sections in book order, named by 1.0's
   sidebar rule (outline.ts), with 1.0's row markup and icons
   (renderSidebar: .sec-item[data-sec] role=button, .drag icon, .sec-name).
   A section whose content is not text cannot be opened in the editor. */
export function Outline() {
  const { t } = useLocale();
  const bk = useBook();
  return (
    <ul id="structureList" aria-label={t('tabs.structure')}>
      {bk.rows.map((r) => {
        const icon: IconName = r.isPart ? 'Bookmark' : r.kind === 'body' ? 'GripVertical' : r.type === 'toc' ? 'ListOrdered' : r.type === 'cover' ? 'Image' : 'FileText';
        const isActive = bk.active === r.index;
        const open = () => r.editable && bk.select(r.index);
        return (
          <li key={r.index + ':' + r.id}>
            <div
              className={'sec-item' + (isActive ? ' active' : '') + (r.isPart ? ' part-item' : '')}
              data-sec={r.id}
              role="button"
              tabIndex={0}
              aria-current={isActive ? 'true' : undefined}
              aria-disabled={r.editable ? undefined : 'true'}
              onClick={open}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  open();
                }
              }}
            >
              <span className="drag">
                <Icon name={icon} />
              </span>
              <span className="sec-name">{r.name}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
