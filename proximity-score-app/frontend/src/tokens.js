/**
 * tokens.js — shared design tokens for the Proximity Score app.
 * Import `T` in any component to access colors and font-size tiers.
 * Individual usages can still override locally by passing an explicit value.
 */
export const T = {
  // -- Surfaces ----------------------------------------------------------------
  bg:          '#0a0a0a',
  surface:     '#111111',
  elevated:    '#1a1a1a',
  heatBg:      '#141414',

  // -- Borders -----------------------------------------------------------------
  border:      '#222222',
  borderHover: '#444444',

  // -- Text --------------------------------------------------------------------
  text:        '#ededed',
  muted:       '#666666',
  faint:       '#333333',

  // -- Font sizes (px) ---------------------------------------------------------
  sz: {
    xs:     10,   // muted control labels
    sm:     11,   // compact inputs / SVG text
    pill:   12,   // badge / pill text
    ui:     13,   // labels, selects, ghost btns
    btn:    14,   // primary buttons, textarea
    status: 18,   // StatusBar
  },
};
