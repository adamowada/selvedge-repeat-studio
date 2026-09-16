import type { EditAction } from './Workspace';
import { Icon, type IconName } from './Icon';

const groups: { label: string; tools: { action: EditAction; icon: IconName; label: string; text: string; short?: string }[] }[] = [
  { label: 'Duplicate placement', tools: [{ action: 'duplicate', icon: 'duplicate', label: 'Duplicate', text: 'Duplicate' }] },
  { label: 'Flip placement', tools: [
    { action: 'flipH', icon: 'flipH', label: 'Flip horizontal', text: 'Flip H', short: 'H' },
    { action: 'flipV', icon: 'flipV', label: 'Flip vertical', text: 'Flip V', short: 'V' },
  ] },
  { label: 'Placement stacking', tools: [
    { action: 'front', icon: 'front', label: 'Bring to front', text: 'Front' },
    { action: 'back', icon: 'back', label: 'Send to back', text: 'Back' },
  ] },
  { label: 'Delete placement', tools: [{ action: 'delete', icon: 'trash', label: 'Delete', text: 'Delete' }] },
];
interface Props { selected: boolean; name?: string; busy: boolean; onAction: (action: EditAction) => void }
export function SelectionToolbar({ selected, name, busy, onAction }: Props) {
  return <div className="canvas-toolbar" aria-label="Placement actions">
    {!selected ? <span className="no-selection">No selection <span>· Click a repeat copy or use Placements</span></span> : <>
      <div className="selection-context" title={name}><span>Selected</span><strong>{name ?? 'Placement'}</strong></div>
      <div className="selection-tools">
        {groups.map(group => <div className="selection-group" key={group.label} role="group" aria-label={group.label}>
          {group.tools.map(tool => <button key={tool.action}
            className={`selection-button ${tool.action === 'delete' ? 'danger-button' : ''} ${tool.action === 'duplicate' || tool.action === 'delete' ? 'optional-label' : ''}`}
            title={tool.label} aria-label={tool.label} disabled={busy} onClick={() => onAction(tool.action)}>
            <Icon name={tool.icon} size={16} /><span className={tool.short ? 'tool-full' : ''}>{tool.text}</span>
            {tool.short && <span className="tool-short" aria-hidden="true">{tool.short}</span>}
          </button>)}
        </div>)}
      </div>
    </>}
  </div>;
}
