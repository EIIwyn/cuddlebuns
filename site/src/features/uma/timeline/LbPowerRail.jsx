import { LB_BREAKPOINTS, normalizeLbBreakpoints } from './lb-breakpoints';

export function LbPowerRail({ breakpoints, size = 'compact', showLabels = false }) {
  const active = normalizeLbBreakpoints(breakpoints);
  if (size === 'compact' && !active.length) return null;
  return <span className={`uma-lb-power-rail uma-lb-power-rail--${size}`} aria-hidden={size === 'compact' || undefined}><span className="uma-lb-power-rail__track" />{LB_BREAKPOINTS.map((level) => <i className={active.includes(level) ? 'is-active' : ''} key={level} />)}{showLabels && active.length > 0 && <small>{active.join(' · ')}</small>}</span>;
}
