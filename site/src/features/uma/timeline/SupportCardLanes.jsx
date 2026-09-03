import { ModernImage } from '../../../components/ModernImage';
import { dateRangeLabel, eventTypeLabel } from './timeline-model';

const labelFor = (card) => card.characterName || card.name || card.slug;

export function SupportCardControls({ cards, filters, onChange, onReset, selectedCount, onClearSelected }) {
  const types = [...new Set(cards.map((card) => card.cardType).filter(Boolean))].sort();
  const styles = [...new Set(cards.flatMap((card) => card.styles ?? []))].sort();
  return <div className="uma-support-controls"><input value={filters.query} onChange={(event) => onChange({ ...filters, query: event.target.value })} placeholder="Search card or character" aria-label="Search support cards" /><select value={filters.type} onChange={(event) => onChange({ ...filters, type: event.target.value })} aria-label="Filter by card type"><option value="">All types</option>{types.map((type) => <option key={type}>{type}</option>)}</select><select value={filters.style} onChange={(event) => onChange({ ...filters, style: event.target.value })} aria-label="Filter by running style"><option value="">All styles</option>{styles.map((style) => <option key={style}>{style}</option>)}</select><button type="button" onClick={onReset}>Clear filters</button>{selectedCount > 0 && <button type="button" onClick={onClearSelected}>Clear selected ({selectedCount})</button>}</div>;
}

function UsageMarker({ card, event, scenario, selectedEvent, onEventSelect, onEventHighlight }) {
  const selected = event.id === selectedEvent?.id;
  const tooltip = `${labelFor(card)} · ${eventTypeLabel(event.eventType)}: ${event.name} · ${dateRangeLabel(event.startDate, event.endDate)}${scenario ? ` · ${scenario.name}` : ''}${event.distanceClass || event.racecourse ? ` · ${[event.distanceClass, event.distanceM ? `${event.distanceM}m` : null, event.racecourse].filter(Boolean).join(' · ')}` : ''}. Styles are card-wide: ${(card.styles ?? []).join(', ') || 'none listed'}.`;
  return <button className={`uma-support-usage uma-event-marker--${event.typeKind}${selected ? ' is-selected' : ''}`} style={{ left: `${event.startPercent}%` }} title={tooltip} aria-label={tooltip} type="button" onMouseEnter={() => onEventHighlight(event.id)} onMouseLeave={() => onEventHighlight(null)} onFocus={() => onEventHighlight(event.id)} onBlur={() => onEventHighlight(null)} onClick={() => onEventSelect(event)} />;
}

export function CardReleaseLane({ cards, selectedIds, onToggle, onCardHighlight }) {
  return <div className="uma-release-lane"><div className="uma-lane__label">Card releases</div><div className="uma-lane__track">{cards.map((card, index) => card.releasePercent != null && <button key={card.id} className={`uma-card-release${selectedIds.has(card.id) ? ' is-selected' : ''}`} style={{ left: `${card.releasePercent}%`, '--stack': index % 3 }} type="button" title={`${labelFor(card)} · ${card.cardType || 'Support card'} · Released ${dateRangeLabel(card.releaseDate, card.releaseDate)} · ${(card.styles ?? []).join(', ') || 'No styles listed'}`} aria-label={`${selectedIds.has(card.id) ? 'Remove' : 'Add'} ${labelFor(card)}. Released ${dateRangeLabel(card.releaseDate, card.releaseDate)}.`} aria-pressed={selectedIds.has(card.id)} onMouseEnter={() => onCardHighlight(card.id)} onMouseLeave={() => onCardHighlight(null)} onFocus={() => onCardHighlight(card.id)} onBlur={() => onCardHighlight(null)} onClick={() => onToggle(card.id)}>{card.image ? <ModernImage src={card.image} alt="" sizes="42px" /> : <span>{labelFor(card).slice(0, 1)}</span>}</button>)}</div></div>;
}

export function SelectedCardRows({ cards, eventById, scenarioById, selectedEvent, onEventSelect, onEventHighlight, onRemove }) {
  if (!cards.length) return <p className="uma-support-empty">Select support cards from the release timeline to compare their event appearances.</p>;
  return <div className="uma-support-lanes"><div className="uma-support-heading"><span>Selected cards</span><small>Linked appearances are discrete event references, not relevance periods.</small></div>{cards.map((card) => <div className="uma-support-row" key={card.id} onMouseEnter={() => onEventHighlight(null)}><div className="uma-support-identity">{card.image ? <ModernImage src={card.image} alt="" sizes="52px" /> : <span className="uma-support-image-fallback" aria-hidden="true" />}<span><strong>{labelFor(card)}</strong><small>{card.cardType || 'Support card'}</small><em>{(card.styles ?? []).join(' · ') || 'No styles listed'}</em></span><button className="uma-support-remove" type="button" onClick={() => onRemove(card.id)} aria-label={`Remove ${labelFor(card)} from comparison`}>×</button></div><div className="uma-lane__track uma-support-track">{card.eventIds.map((id) => eventById.get(id)).filter(Boolean).map((event) => <UsageMarker key={event.id} card={card} event={event} scenario={scenarioById.get(event.scenarioId)} selectedEvent={selectedEvent} onEventSelect={onEventSelect} onEventHighlight={onEventHighlight} />)}</div></div>)}</div>;
}
