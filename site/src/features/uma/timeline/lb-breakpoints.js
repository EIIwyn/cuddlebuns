export const LB_BREAKPOINTS = ['0LB', '1LB', '2LB', '3LB', 'MLB'];

const NORMALIZED_BREAKPOINTS = new Map([
  ['0', '0LB'], ['0LB', '0LB'],
  ['1', '1LB'], ['1LB', '1LB'],
  ['2', '2LB'], ['2LB', '2LB'],
  ['3', '3LB'], ['3LB', '3LB'],
  ['M', 'MLB'], ['MLB', 'MLB'],
]);

export function normalizeLbBreakpoints(values) {
  const source = Array.isArray(values) ? values : values == null ? [] : [values];
  const normalized = new Set(source.map((value) => NORMALIZED_BREAKPOINTS.get(String(value).trim().toUpperCase())).filter(Boolean));
  return LB_BREAKPOINTS.filter((value) => normalized.has(value));
}

export function lbBreakpointLabels(values) {
  return normalizeLbBreakpoints(values).join(' · ');
}
