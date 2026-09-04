import { ModernImage } from '../../../components/ModernImage';
import { dateRangeLabel, eventTypeLabel, formatDate } from './timeline-model';
import { LbPowerRail } from './LbPowerRail';
import { lbBreakpointLabels } from './lb-breakpoints';

const labelFor = (card) => card.characterName || card.name || card.slug;

function specializedSubtype(rating) {
  return ({ 'Style Niche': 'style', 'Distance Specific': 'distance', Parenting: 'parenting' })[rating] ?? null;
}

function cardTypeBadge(cardType) {
  const type = String(cardType ?? '').toLowerCase();
  if (type.includes('speed')) return ['speed', 'SPD'];
  if (type.includes('stamina')) return ['stamina', 'STA'];
  if (type.includes('power')) return ['power', 'PWR'];
  if (type.includes('guts')) return ['guts', 'GUT'];
  if (type.includes('wisdom') || type.includes('wit')) return ['wisdom', 'WIT'];
  if (type.includes('friend')) return ['friend', 'FRN'];
  if (type.includes('group')) return ['group', 'GRP'];
  return ['other', cardType ? String(cardType).slice(0, 3).toUpperCase() : '?'];
}

const CARD_TRACK_CLEARANCE_PERCENT = 2.2;
const CARD_TRACK_STEP_PX = 17;

function releasePlacements(cards) {
  const datedCards = cards.filter((card) => card.releasePercent != null).sort((a, b) => a.releasePercent - b.releasePercent);
  const trackEnds = [];
  return datedCards.map((card) => {
    let track = trackEnds.findIndex((lastPercent) => card.releasePercent - lastPercent >= CARD_TRACK_CLEARANCE_PERCENT);
    if (track === -1) track = trackEnds.length;
    trackEnds[track] = card.releasePercent;
    return { card, track };
  });
}

export function SupportCardControls({ cards, filters, onChange, onReset, selectedCount, onClearSelected }) {
  const types = [...new Set(cards.map((card) => card.cardType).filter(Boolean))].sort();
  const styles = [...new Set(cards.flatMap((card) => card.styles ?? []))].sort();
  return <div className="uma-support-controls"><input value={filters.query} onChange={(event) => onChange({ ...filters, query: event.target.value })} placeholder="Search card or character" aria-label="Search support cards" /><select value={filters.type} onChange={(event) => onChange({ ...filters, type: event.target.value })} aria-label="Filter by card type"><option value="">All types</option>{types.map((type) => <option key={type}>{type}</option>)}</select><select value={filters.style} onChange={(event) => onChange({ ...filters, style: event.target.value })} aria-label="Filter by running style"><option value="">All styles</option>{styles.map((style) => <option key={style}>{style}</option>)}</select><button type="button" onClick={onReset}>Clear filters</button>{selectedCount > 0 && <button type="button" onClick={onClearSelected}>Clear selected ({selectedCount})</button>}</div>;
}

function UsageMarker({ card, event, scenario, selectedEvent, onEventSelect, onEventHighlight }) {
  const selected = event.id === selectedEvent?.id;
  const tooltip = `${labelFor(card)} · ${eventTypeLabel(event.eventType)}: ${event.name} · ${dateRangeLabel(event.startDate, event.endDate)}${scenario ? ` · ${scenario.name}` : ''}${event.distanceClass || event.racecourse ? ` · ${[event.distanceClass, event.distanceM ? `${event.distanceM}m` : null, event.racecourse].filter(Boolean).join(' · ')}` : ''}. Styles are card-wide: ${(card.styles ?? []).join(', ') || 'none listed'}.`;
  return <button className={`uma-support-usage uma-event-marker--${event.typeKind}${selected ? ' is-selected' : ''}`} style={{ left: `${event.startPercent}%`, '--course-color': event.courseColor }} title={tooltip} aria-label={tooltip} type="button" onMouseEnter={() => onEventHighlight(event.id)} onMouseLeave={() => onEventHighlight(null)} onFocus={() => onEventHighlight(event.id)} onBlur={() => onEventHighlight(null)} onClick={() => onEventSelect(event)} />;
}

export function CardReleaseLane({ cards, selectedIds, hoveredCardId, onToggle, onCardHighlight }) {
  const ratingLanes = [
    ['Auto Include', ['Auto Include']],
    ['Style Core', ['Style Core']],
    ['Specialized', ['Style Niche', 'Distance Specific']],
    ['Borrow', ['Borrow']],
  ];
  const knownRatings = ratingLanes.flatMap(([, ratings]) => ratings);
  const lanes = [...ratingLanes.map(([label, ratings]) => [label, cards.filter((card) => ratings.includes(card.rating))]), ['Unrated', cards.filter((card) => !knownRatings.includes(card.rating))]].filter(([, items]) => items.length);
  return <div className="uma-release-lanes"><div className="uma-release-heading">Card releases</div>{lanes.map(([rating, items]) => { const placements = releasePlacements(items); const trackCount = Math.max(...placements.map(({ track }) => track + 1), 1); const expandedBorrow = rating === 'Borrow' && items.some((card) => selectedIds.has(card.id)); return <div className={`uma-release-lane uma-release-lane--${rating.toLowerCase().replaceAll(' ', '-')}${trackCount > 1 ? ' has-release-tracks' : ''}${expandedBorrow ? ' is-expanded' : ''}`} style={{ '--release-track-height': `${30 + trackCount * CARD_TRACK_STEP_PX}px`, '--expanded-release-track-height': `${30 + trackCount * 53}px` }} key={rating}><div className="uma-lane__label">{rating}</div><div className="uma-lane__track">{placements.filter(({ card }) => selectedIds.has(card.id) || card.id === hoveredCardId).map(({ card }) => <div className="uma-release-date-guide" key={`guide-${card.id}`} style={{ left: `${card.releasePercent}%` }} aria-hidden="true"><span>EST. {formatDate(card.releaseDate)}</span></div>)}{placements.map(({ card, track }) => { const subtype = specializedSubtype(card.rating); const [type, badge] = cardTypeBadge(card.cardType); const breakpointLabels = lbBreakpointLabels(card.breakpoints); const emphasized = selectedIds.has(card.id) || card.id === hoveredCardId; return <button key={card.id} className={`uma-card-release uma-card-release--type-${type} is-release-tracked${emphasized ? ' is-emphasized' : ''}${selectedIds.has(card.id) ? ' is-selected' : ''}${subtype ? ` uma-card-release--${subtype}` : ''}`} style={{ left: `${card.releasePercent}%`, '--track-y': `${track * CARD_TRACK_STEP_PX}px`, '--expanded-track-y': `${track * 53}px` }} type="button" title={breakpointLabels || undefined} aria-label={`${selectedIds.has(card.id) ? 'Remove' : 'Add'} ${labelFor(card)}. ${rating}. ${card.cardType || 'Support card'}.${breakpointLabels ? ` ${breakpointLabels}.` : ''}`} aria-pressed={selectedIds.has(card.id)} onMouseEnter={() => onCardHighlight(card.id)} onMouseLeave={() => onCardHighlight(null)} onFocus={() => onCardHighlight(card.id)} onBlur={() => onCardHighlight(null)} onClick={() => onToggle(card.id)}>{card.image ? <ModernImage src={card.image} alt="" sizes="42px" /> : <span>{labelFor(card).slice(0, 1)}</span>}<b aria-hidden="true">{badge}</b><LbPowerRail breakpoints={card.breakpoints} />{subtype && <i aria-hidden="true">{subtype === 'style' ? 'S' : subtype === 'distance' ? 'D' : 'P'}</i>}</button>; })}</div></div>; })}</div>;
}

export function SelectedCardRows({ cards, eventById, scenarioById, selectedEvent, onEventSelect, onEventHighlight, onRemove }) {
  if (!cards.length) return null;
  return <div className="uma-support-lanes"><div className="uma-support-heading"><span>Selected cards</span><small>Linked appearances are discrete event references, not relevance periods.</small></div>{cards.map((card) => { const linkedEvents = card.eventIds.map((id) => eventById.get(id)).filter(Boolean); return <div className="uma-support-row" key={card.id} onMouseEnter={() => onEventHighlight(null)}><div className="uma-support-identity">{card.image ? <ModernImage src={card.image} alt="" sizes="52px" /> : <span className="uma-support-image-fallback" aria-hidden="true" />}<span><strong title={labelFor(card)}>{labelFor(card)}</strong><small>{card.cardType || 'Support card'} · <b title={`${linkedEvents.length} linked PvP event${linkedEvents.length === 1 ? '' : 's'}`}>#{linkedEvents.length}</b></small><LbPowerRail breakpoints={card.breakpoints} size="expanded" showLabels /></span><button className="uma-support-remove" type="button" onClick={() => onRemove(card.id)} aria-label={`Remove ${labelFor(card)} from comparison`}>×</button></div><div className="uma-lane__track uma-support-track">{linkedEvents.map((event) => <UsageMarker key={event.id} card={card} event={event} scenario={scenarioById.get(event.scenarioId)} selectedEvent={selectedEvent} onEventSelect={onEventSelect} onEventHighlight={onEventHighlight} />)}</div></div>; })}</div>;
}
