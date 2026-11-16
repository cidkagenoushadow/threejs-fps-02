// The look plan, in one place. Dusk in a container yard: deep indigo dusk, warm sodium
// orange as the one accent, cyan for allies, red-orange for foes. The same names are the
// CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#151824',
  surface: '#282f42',
  hairline: '#3e4763',
  ink: '#ece6d4',
  muted: '#93a0b4',
  accent: '#ff9a2e',
  foe: '#ff5346',
  ally: '#5fc4e8',
};

export function shade(name) {
  return PALETTE[name];
}
