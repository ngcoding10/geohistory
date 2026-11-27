// Event types: label for filters, colour for map markers and list dots.
export const TYPES = {
  war: { label: 'Wars', one: 'War', color: '#8c2f1f' },
  battle: { label: 'Battles and sieges', one: 'Battle', color: '#b6462c' },
  revolt: { label: 'Revolts and protests', one: 'Revolt or protest', color: '#c07a1c' },
  violence: { label: 'Massacres and attacks', one: 'Massacre or attack', color: '#6e2a4c' },
  treaty: { label: 'Treaties', one: 'Treaty', color: '#2c5f8f' },
  state: { label: 'New and ended states', one: 'State change', color: '#1e6c58' },
  ruler: { label: 'Rulers', one: 'Ruler', color: '#86641c' },
  politics: { label: 'Politics and law', one: 'Politics', color: '#4a5462' },
  economy: { label: 'Economy', one: 'Economic event', color: '#3f6f6a' },
  epidemic: { label: 'Epidemics', one: 'Epidemic', color: '#5b6d22' },
  disaster: { label: 'Disasters', one: 'Disaster', color: '#9a4a12' },
  discovery: { label: 'Discovery and exploration', one: 'Discovery', color: '#3b57a0' },
  invention: { label: 'Inventions and scientific discoveries', one: 'Invention or discovery', color: '#0f7c8c' },
  religion: { label: 'Religion', one: 'Religion', color: '#6a4c92' },
  founding: { label: 'Cities and institutions founded', one: 'Founding', color: '#7a6a3a' },
  culture: { label: 'Cultures and periods', one: 'Culture or period', color: '#7d5a3c' },
  birth: { label: 'Births', one: 'Birth', color: '#8a7f99' },
  death: { label: 'Deaths', one: 'Death', color: '#5d5d5d' },
  other: { label: 'Other events', one: 'Event', color: '#6b6359' },
};
export const TYPE_KEYS = Object.keys(TYPES);
export const typeColor = (t) => (TYPES[t] || TYPES.other).color;
