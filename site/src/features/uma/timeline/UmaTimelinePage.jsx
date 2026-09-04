import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchUmaTimeline } from '../api';
import { ModernImage } from '../../../components/ModernImage';
import { createTimelineModel, dateRangeLabel, eventTypeLabel, formatDate } from './timeline-model';
import { CardReleaseLane, SelectedCardRows, SupportCardControls } from './SupportCardLanes';
import { lbBreakpointLabels } from './lb-breakpoints';
import './timeline.css';

function TimelineLoading() {
  return <div className="uma-state" role="status">Loading Global timeline…</div>;
}

function TimelineError({ message }) {
  return <div className="uma-state uma-state--error"><h2>Timeline unavailable</h2><p>{message}</p></div>;
}

function scenarioLabel(scenario) {
  const width = (scenario.endPercent ?? 0) - (scenario.startPercent ?? 0);
  const fullNameFits = width >= Math.max(8, scenario.name.length * 1.05);
  return fullNameFits || !scenario.shortName ? scenario.name : scenario.shortName;
}

const breakpointLabel = (card) => lbBreakpointLabels(card.breakpoints);

function eventAriaLabel(event, selected) {
  const course = [event.surface, event.distanceClass, event.distanceM ? `${event.distanceM}m` : null].filter(Boolean).join(' ');
  return `${selected ? 'Selected. ' : ''}${eventTypeLabel(event.eventType)}: ${event.name}, ${course ? `${course}, ` : ''}${dateRangeLabel(event.startDate, event.endDate)}. Show details.`;
}

function EventCard({ event, active, onSelect }) {
  const metadata = [
    [event.racecourse, [event.distanceClass, event.distanceM ? `${event.distanceM}m` : null].filter(Boolean).join(' ')],
    [event.surface, event.direction, event.trackCondition],
    [event.season, event.weather],
  ].map((parts) => parts.filter(Boolean).join(' · ')).filter(Boolean);
  return (
    <button className={`uma-event-card uma-event-card--${event.typeKind}${active ? ' is-active' : ''}`} style={{ '--course-color': event.courseColor }} onClick={() => onSelect(event)} type="button">
      <span className="uma-event-card__type"><i aria-hidden="true" />{eventTypeLabel(event.eventType)}</span>
      <strong>{event.name}</strong>
      <span>{dateRangeLabel(event.startDate, event.endDate)}</span>
      {metadata.map((line, index) => <small key={index}>{line}</small>)}
      {event.scenarioName && <small>Scenario: {event.scenarioName}</small>}
      {event.status === 'projected' && <em>Projected</em>}
    </button>
  );
}

function EventDetails({ event, scenario, supportCards, selectedCardIds, onToggleCard, onClose }) {
  const details = [
    ['Scenario', scenario?.name],
    ['Racecourse', event.racecourse],
    ['Distance', [event.distanceClass, event.distanceM ? `${event.distanceM}m` : null].filter(Boolean).join(' · ')],
    ['Direction', event.direction],
    ['Track condition', event.trackCondition],
    ['Season', event.season],
    ['Weather', event.weather],
    ['Surface', event.surface],
  ].filter(([, value]) => value);
  return (
    <aside className="uma-details" style={{ '--course-color': event.courseColor }} aria-live="polite" aria-label={`${event.name} details`}>
      <button onClick={onClose} type="button" aria-label="Close event details">×</button>
      <p className="eyebrow">{eventTypeLabel(event.eventType)}</p>
      <h2>{event.name}</h2>
      <p className="uma-details__date">{dateRangeLabel(event.startDate, event.endDate)}</p>
      {details.length > 0 && (
        <dl className="uma-details__meta">
          {details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      )}
      {supportCards.length > 0 && <section className="uma-details__cards" aria-label="Support cards linked to this event"><p className="eyebrow">Linked support cards</p><div>{supportCards.map((card) => <button key={card.id} className={`uma-details-card${selectedCardIds.has(card.id) ? ' is-selected' : ''}`} type="button" onClick={() => onToggleCard(card.id)} title={`${card.characterName || card.name} · ${card.rating || 'Unrated'} · ${card.cardType || 'Support card'}`} aria-pressed={selectedCardIds.has(card.id)} aria-label={`${selectedCardIds.has(card.id) ? 'Remove' : 'Add'} ${card.characterName || card.name} to selected cards`}>{card.image ? <ModernImage src={card.image} alt="" sizes="60px" /> : <span className="uma-support-image-fallback" aria-hidden="true" />}<span><strong>{card.characterName || card.name}</strong><small>{[card.rating, card.cardType].filter(Boolean).join(' · ')}</small>{breakpointLabel(card) && <small className="uma-details-card__breakpoints">{breakpointLabel(card)}</small>}</span></button>)}</div></section>}
      {event.status === 'projected' && <p className="uma-details__projected">Projected information — subject to change.</p>}
    </aside>
  );
}

function TimelineChart({ model, selectedCards, selectedEvent, highlightedEventId, hoveredCardId, selectedCardIds, onSelect, onEventHighlight, onCardHighlight, onToggleCard, onRemoveCard }) {
  const pan = useRef(null);
  const eventById = useMemo(() => new Map(model.events.map((event) => [event.id, event])), [model.events]);
  const scenarioById = useMemo(() => new Map(model.scenarios.map((scenario) => [scenario.id, scenario])), [model.scenarios]);
  const hoveredEventIds = useMemo(() => new Set(model.supportCards.find((card) => card.id === hoveredCardId)?.eventIds ?? []), [hoveredCardId, model.supportCards]);
  return (
    <section
      className="uma-timeline"
      aria-label="Uma Musume Global timeline"
      onPointerDown={(event) => {
        if (event.target.closest('button, input, select')) return;
        pan.current = { x: event.clientX, scrollLeft: event.currentTarget.scrollLeft };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!pan.current) return;
        event.currentTarget.scrollLeft = pan.current.scrollLeft - (event.clientX - pan.current.x);
      }}
      onPointerUp={() => { pan.current = null; }}
      onPointerCancel={() => { pan.current = null; }}
    >
      <div className="uma-chart" role="group" aria-label="Scenario eras and PvP events by date">
        <div className="uma-axis" aria-hidden="true">
          {model.today && <div className="uma-today-line" style={{ left: `${model.today.percent}%` }}><span>TODAY · {formatDate(model.today.date, { month: 'short', day: 'numeric' })}</span></div>}
          {model.ticks.map((tick) => (
            <div className={`uma-axis-tick is-${tick.kind}`} key={tick.key} style={{ left: `${tick.percent}%` }}>
              {(tick.kind === 'year' || tick.kind === 'quarter') && <span>{tick.label}</span>}
            </div>
          ))}
        </div>
        <div className="uma-lane uma-lane--scenarios">
          <div className="uma-lane__label">Scenarios</div>
          <div className="uma-lane__track">
            {model.scenarios.map((scenario) => {
              const width = Math.max(0, (scenario.endPercent ?? 0) - (scenario.startPercent ?? 0));
              return width > 0 && (
                <div
                  className="uma-scenario-band"
                  key={scenario.id}
                  style={{ left: `${scenario.startPercent}%`, width: `${width}%`, '--scenario-color': scenario.displayColor || '#9b87f5' }}
                  title={`${scenario.name}: ${dateRangeLabel(scenario.eraStart, scenario.eraEnd)}`}
                  aria-label={`${scenario.name}: ${dateRangeLabel(scenario.eraStart, scenario.eraEnd)}`}
                >
                  <b>{scenarioLabel(scenario)}</b>
                </div>
              );
            })}
          </div>
        </div>
        <div className="uma-lane uma-lane--events">
          <div className="uma-lane__label">PvP events</div>
          <div className="uma-lane__track">
            {model.events.map((event) => {
              const selected = event.id === selectedEvent?.id;
              return (
                <button
                  className={`uma-event-marker uma-event-marker--${event.typeKind}${selected ? ' is-selected' : ''}${hoveredEventIds.has(event.id) || highlightedEventId === event.id ? ' is-linked' : ''}${event.status === 'projected' ? ' is-projected' : ''}`}
                  key={event.id}
                  style={{ left: `${event.startPercent ?? 0}%`, '--course-color': event.courseColor }}
                  onMouseEnter={() => onEventHighlight(event.id)} onMouseLeave={() => onEventHighlight(null)} onFocus={() => onEventHighlight(event.id)} onBlur={() => onEventHighlight(null)}
                  onClick={() => onSelect(selected ? null : event)}
                  type="button"
                  aria-pressed={selected}
                  aria-label={eventAriaLabel(event, selected)}
                ><span aria-hidden="true" /></button>
              );
            })}
          </div>
        </div>
        <CardReleaseLane cards={model.supportCards} selectedIds={selectedCardIds} hoveredCardId={hoveredCardId} onToggle={onToggleCard} onCardHighlight={onCardHighlight} />
        <SelectedCardRows cards={selectedCards} eventById={eventById} scenarioById={scenarioById} selectedEvent={selectedEvent} onEventSelect={onSelect} onEventHighlight={onEventHighlight} onRemove={onRemoveCard} />
      </div>
    </section>
  );
}

export function UmaTimelinePage() {
  const [timeline, setTimeline] = useState(null);
  const [error, setError] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [filters, setFilters] = useState({ query: '', type: '', style: '' });
  const [highlightedEventId, setHighlightedEventId] = useState(null);
  const [hoveredCardId, setHoveredCardId] = useState(null);
  const [selectedCardIds, setSelectedCardIds] = useState(() => new Set());

  useEffect(() => {
    const controller = new AbortController();
    fetchUmaTimeline(controller.signal).then(setTimeline).catch((requestError) => {
      if (requestError.name !== 'AbortError') setError(requestError.message);
    });
    return () => controller.abort();
  }, []);

  const model = useMemo(() => timeline ? createTimelineModel(timeline) : null, [timeline]);
  const scenarioById = useMemo(() => new Map(timeline?.scenarios.map((scenario) => [scenario.id, scenario])), [timeline]);
  const selectedScenario = selectedEvent?.scenarioId ? scenarioById.get(selectedEvent.scenarioId) : null;
  const selectedEventCards = useMemo(() => selectedEvent ? (model?.supportCards ?? []).filter((card) => card.eventIds.includes(selectedEvent.id)) : [], [model, selectedEvent]);
  const filteredCards = useMemo(() => (model?.supportCards ?? []).filter((card) => {
    const query = filters.query.trim().toLowerCase();
    return (!query || [card.name, card.characterName, card.slug].filter(Boolean).some((value) => value.toLowerCase().includes(query))) &&
      (!filters.type || card.cardType === filters.type) && (!filters.style || card.styles?.includes(filters.style));
  }), [filters, model]);
  const visibleModel = useMemo(() => model ? { ...model, supportCards: filteredCards } : null, [filteredCards, model]);
  const selectedCards = useMemo(() => (model?.supportCards ?? []).filter((card) => selectedCardIds.has(card.id)), [model, selectedCardIds]);
  const toggleCard = (id) => setSelectedCardIds((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const removeCard = (id) => setSelectedCardIds((current) => { const next = new Set(current); next.delete(id); return next; });

  return (
    <div className="site-shell uma-shell">
      <header className="site-nav uma-nav"><Link className="site-nav__brand" to="/">Cuddlebuns</Link><span>Uma Musume Global</span></header>
      <main className="uma-page page-width">
        {error ? <TimelineError message={error} /> : !model ? <TimelineLoading /> : (
          <>
            <SupportCardControls cards={model.supportCards} filters={filters} onChange={setFilters} onReset={() => setFilters({ query: '', type: '', style: '' })} selectedCount={selectedCards.length} onClearSelected={() => setSelectedCardIds(new Set())} />
            <div className={`uma-timeline-layout${selectedEvent ? ' has-details' : ''}`}>
              <TimelineChart model={visibleModel} selectedCards={selectedCards} selectedEvent={selectedEvent} highlightedEventId={highlightedEventId || selectedEvent?.id} hoveredCardId={hoveredCardId} selectedCardIds={selectedCardIds} onSelect={setSelectedEvent} onEventHighlight={setHighlightedEventId} onCardHighlight={setHoveredCardId} onToggleCard={toggleCard} onRemoveCard={removeCard} />
              {selectedEvent && <EventDetails event={selectedEvent} scenario={selectedScenario} supportCards={selectedEventCards} selectedCardIds={selectedCardIds} onToggleCard={toggleCard} onClose={() => setSelectedEvent(null)} />}
            </div>
            <section className="uma-events" aria-labelledby="uma-events-heading">
              <div className="uma-section-heading">
                <div><p className="eyebrow" id="uma-events-heading">Events</p></div>
                <div className="uma-legend" aria-label="Event marker legend"><span>Shape:</span><span><i className="uma-legend__marker uma-legend__marker--cm" aria-hidden="true" />Champions Meeting</span><span><i className="uma-legend__marker uma-legend__marker--loh" aria-hidden="true" />League of Heroes</span><span>Course:</span>{[['sprint','Sprint'],['mile','Mile'],['medium','Medium'],['long','Long'],['dirt','Dirt']].map(([key,label]) => <span key={key}><i className="uma-legend__course" style={{ '--course-color': `var(--uma-course-${key})` }} aria-hidden="true" />{label}</span>)}</div>
              </div>
              <div className="uma-event-grid">{model.events.map((event) => <EventCard key={event.id} event={event} active={selectedEvent?.id === event.id} onSelect={setSelectedEvent} />)}</div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
