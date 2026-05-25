/**
 * heatColor.js
 * Pure functions mapping a normalized [0, 1] value to a CSS hsla color string.
 * Each scheme takes (value, alpha) and returns a CSS color.
 * alpha is in [0, 1] — pass 0.75 for 25% transparency.
 */

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpHsl(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

/**
 * Evaluate a piecewise linear color ramp.
 * stops: Array of [position, [h, s, l]] where position is in [0, 1].
 */
function piecewise(stops, value) {
  const v = Math.max(0, Math.min(1, value));
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (v <= t1) {
      const t = (v - t0) / (t1 - t0);
      return lerpHsl(c0, c1, t);
    }
  }
  return stops[stops.length - 1][1];
}

function toHsla(hsl, alpha) {
  return `hsla(${hsl[0].toFixed(1)}, ${hsl[1].toFixed(1)}%, ${hsl[2].toFixed(1)}%, ${alpha})`;
}

// -- Color schemes ------------------------------------------------------------

const STOPS_BLUE_WHITE_RED = [
  [0.0,  [240, 100, 50]],
  [0.5,  [  0,   0, 100]],
  [1.0,  [  0, 100,  50]],
];

const STOPS_VIRIDIS = [
  [0.0,  [275,  65,  20]],
  [0.25, [245,  75,  45]],
  [0.5,  [175,  65,  42]],
  [0.75, [140,  55,  48]],
  [1.0,  [ 62,  90,  55]],
];

const STOPS_PLASMA = [
  [0.0,  [268,  70,  28]],
  [0.33, [310,  75,  48]],
  [0.67, [ 22,  95,  53]],
  [1.0,  [ 55,  95,  62]],
];

const STOPS_HOT = [
  [0.0,  [  0,   0,   0]],
  [0.33, [  0, 100,  30]],
  [0.67, [ 35, 100,  50]],
  [1.0,  [ 55, 100,  80]],
];

const STOPS_INFERNO = [
  [0.0,  [  0,   0,   2]],
  [0.25, [280,  70,  30]],
  [0.5,  [330,  85,  45]],
  [0.75, [ 15, 100,  52]],
  [1.0,  [ 53,  95,  72]],
];

const STOPS_GRAYSCALE = [
  [0.0,  [0, 0,  5]],
  [1.0,  [0, 0, 95]],
];

const SCHEME_STOPS = {
  'Blue-White-Red': STOPS_BLUE_WHITE_RED,
  'Viridis':        STOPS_VIRIDIS,
  'Plasma':         STOPS_PLASMA,
  'Hot':            STOPS_HOT,
  'Inferno':        STOPS_INFERNO,
  'Grayscale':      STOPS_GRAYSCALE,
};

export const COLOR_SCHEME_NAMES = Object.keys(SCHEME_STOPS).sort();

/**
 * Map a normalized [0, 1] value to a CSS color string.
 *
 * @param {number} value  - normalized float in [0, 1]
 * @param {string} scheme - one of COLOR_SCHEME_NAMES
 * @param {number} alpha  - opacity in [0, 1]
 * @returns {string} CSS hsla color string
 */
export function heatToColor(value, scheme = 'Blue-White-Red', alpha = 1.0) {
  const stops = SCHEME_STOPS[scheme] ?? STOPS_BLUE_WHITE_RED;
  const hsl   = piecewise(stops, value);
  return toHsla(hsl, alpha);
}

/**
 * Return the raw [h, s, l] triple for a normalized value and scheme.
 * Used by callers that need to construct their own hsla strings (e.g. gradients).
 *
 * @param {number} value  - normalized float in [0, 1]
 * @param {string} scheme - one of COLOR_SCHEME_NAMES
 * @returns {[number, number, number]} [h, s, l]
 */
export function heatToHsl(value, scheme = 'Blue-White-Red') {
  const stops = SCHEME_STOPS[scheme] ?? STOPS_BLUE_WHITE_RED;
  return piecewise(stops, value);
}

/**
 * Build a horizontal CSS linear-gradient for a chip.
 * Edges fade to a lower alpha; the center holds the full alpha.
 * The fade depth saturates with chip width so medium and large chips
 * converge to the same edge opacity.
 *
 * @param {number} value       - normalized heat value in [0, 1]
 * @param {string} scheme      - color scheme name
 * @param {number} centerAlpha - opacity at the chip center
 * @param {number} pixelWidth  - measured chip width in px
 * @param {number} minFraction - floor ratio of edgeAlpha / centerAlpha (0..1)
 * @param {number} scale       - width (px) at which fade is ~63% saturated
 * @returns {string} CSS linear-gradient string
 */
export function heatToGradient(value, scheme, centerAlpha, pixelWidth, minFraction, scale) {
  const [h, s, l] = heatToHsl(value, scheme);
  const fadeFactor = Math.exp(-pixelWidth / scale);
  const edgeAlpha  = centerAlpha * (minFraction + (1 - minFraction) * fadeFactor);

  const center = `hsla(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%, ${centerAlpha.toFixed(3)})`;
  const edge   = `hsla(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%, ${edgeAlpha.toFixed(3)})`;

  return `linear-gradient(to right, ${edge}, ${center} 30%, ${center} 70%, ${edge})`;
}
