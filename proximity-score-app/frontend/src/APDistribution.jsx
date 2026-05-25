import { useMemo, useRef } from 'react';
import { heatToColor, COLOR_SCHEME_NAMES } from './heatColor';
import { T } from './tokens';

// SVG layout constants
const W          = 600;
const H          = 178;
const PAD_L      = 6;
const PAD_R      = 6;
const PAD_T      = 8;
const GRAD_H     = 16;
const GRAD_Y     = 106;                      // top of gradient bar (y=106..122)
const CHART_H    = GRAD_Y - PAD_T;           // 98 — histogram fills PAD_T..GRAD_Y
const CHART_W    = W - PAD_L - PAD_R;        // 588
const N_BINS     = 100;
const BIN_W      = CHART_W / N_BINS;         // 5.88 px per bin
const BAR_BOT    = GRAD_Y + GRAD_H;          // y=122 — bottom of gradient bar
const TICK_SM_Y2 = BAR_BOT + 4;             // small (0.1) tick end y=126
const TICK_LG_Y2 = BAR_BOT + 8;             // large (whole) tick end y=130
const TICK_LABEL_Y = TICK_LG_Y2 + 12;       // whole-number label baseline y=142
const RUG_Y0     = TICK_LABEL_Y + 5;        // rug marks start y=147
const RUG_Y1     = RUG_Y0 + 8;             // rug marks end y=155
const AP_Y       = H - 3;                   // metric label y=175

// Histogram
function computeHistogram(values, xMin, xMax) {
  const bins  = new Array(N_BINS).fill(0);
  const range = xMax - xMin;
  if (range <= 0) { bins[Math.floor(N_BINS / 2)] = values.length; return bins; }
  for (const v of values) {
    const idx = Math.min(N_BINS - 1, Math.max(0, Math.floor((v - xMin) / range * N_BINS)));
    bins[idx]++;
  }
  return bins;
}

// Shared drag logic for both the panel Scrubber and the SVG axis labels.
function makeScrubHandler(getStartVal, onChange, speed = 0.02) {
  return function(e) {
    e.preventDefault();
    const startX   = e.clientX;
    const startVal = getStartVal();
    const h        = {};
    h.move = ev => {
      onChange(Math.round((startVal + (ev.clientX - startX) * speed) * 100) / 100);
    };
    h.up = () => {
      window.removeEventListener('mousemove', h.move);
      window.removeEventListener('mouseup',   h.up);
    };
    window.addEventListener('mousemove', h.move);
    window.addEventListener('mouseup',   h.up);
  };
}

// -- Scrubber ----------------------------------------------------------------
// Click-and-drag number control (like Figma / Blender number fields).
// Drag right to increase, left to decrease. `speed` = units per pixel.
function Scrubber({ value, autoValue, onChange, disabled, speed = 0.02 }) {
  const display = (value !== null && value !== undefined ? value : autoValue).toFixed(2);

  function onMouseDown(e) {
    if (disabled) return;
    const startVal = value !== null && value !== undefined ? value : autoValue;
    makeScrubHandler(() => startVal, onChange, speed)(e);
  }

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        cursor:          disabled ? 'default' : 'ew-resize',
        userSelect:      'none',
        width:           '100%',
        fontSize:        T.sz.sm,
        fontFamily:      'inherit',
        backgroundColor: T.elevated,
        color:           disabled ? T.muted : T.text,
        border:          `1px solid ${T.border}`,
        borderRadius:    4,
        padding:         '3px 5px',
        boxSizing:       'border-box',
        opacity:         disabled ? 0.4 : 1,
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'space-between',
        gap:             4,
      }}
    >
      <span style={{ color: T.muted, fontSize: T.sz.xs, lineHeight: 1 }}>‹</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', flex: 1, textAlign: 'center' }}>
        {display}
      </span>
      <span style={{ color: T.muted, fontSize: T.sz.xs, lineHeight: 1 }}>›</span>
    </div>
  );
}

export default function APDistribution({
  heatValues, heatMin, heatMax,
  scheme, onSchemeChange, alpha, metric,
  autoMin, autoMax,
  manualMin, manualMax,
  onManualMinChange, onManualMaxChange,
  hoveredChip = null,
  onBinHover  = () => {},
  activeBin   = null,
}) {
  // Stable gradient id across renders
  const gradId = useRef(`apd-${Math.random().toString(36).slice(2, 8)}`).current;

  const round2 = n => Math.round(n * 100) / 100;
  const isAuto = manualMin === null && manualMax === null;

  const hoveredBin = hoveredChip !== null && heatValues?.[hoveredChip] != null
    ? Math.min(N_BINS - 1, Math.max(0, Math.floor(
        (heatValues[hoveredChip] - heatMin) / Math.max(heatMax - heatMin, 1e-10) * N_BINS
      )))
    : null;

  // Compute histogram bars, rug mark positions, and axis ticks
  const { histBars, rugXs, axisTicks } = useMemo(() => {
    const range = Math.max(heatMax - heatMin, 1e-10);
    const xs    = v => PAD_L + CHART_W * (v - heatMin) / range;
    const validValues = heatValues.filter(v => v !== null);
    const bins  = computeHistogram(validValues, heatMin, heatMax);
    const maxCt = Math.max(...bins, 1);

    const histBars = bins.map((count, i) => ({
      x: PAD_L + i * BIN_W,
      h: CHART_H * (count / maxCt),
    }));
    const rugXs = validValues.map(v =>
      xs(Math.max(heatMin, Math.min(heatMax, v))).toFixed(1)
    );

    // 0.1-interval axis ticks (interior only — min/max end labels handle the edges)
    const axisTicks = [];
    const step      = 0.1;
    const first     = Math.ceil(heatMin / step + 1e-9) * step;
    for (let v = first; v < heatMax - 1e-9; v += step) {
      const rv      = Math.round(v * 10) / 10;   // fix float drift
      const isWhole = Math.abs(rv % 1) < 0.01;
      const nearEdge = Math.abs(rv - heatMin) < 0.2 || Math.abs(rv - heatMax) < 0.2;
      axisTicks.push({ x: xs(rv).toFixed(1), isWhole, label: (isWhole && !nearEdge) ? Math.round(rv) : null });
    }

    return { histBars, rugXs, axisTicks };
  }, [heatValues, heatMin, heatMax]);

  // Gradient bar stops
  const stops = useMemo(() =>
    Array.from({ length: 24 }, (_, i) => ({
      offset: `${(i / 23 * 100).toFixed(1)}%`,
      color:  heatToColor(i / 23, scheme, alpha),
    })),
    [scheme, alpha]
  );

  const selectStyle = {
    width:           '100%',
    fontFamily:      'inherit',
    fontSize:        T.sz.sm,
    backgroundColor: T.elevated,
    color:           T.text,
    border:          `1px solid ${T.border}`,
    borderRadius:    4,
    padding:         '3px 5px',
    cursor:          'pointer',
    outline:         'none',
    boxSizing:       'border-box',
  };

  const muteLabel = {
    fontSize:    T.sz.xs,
    fontWeight:  500,
    color:       T.muted,
    marginBottom: 2,
    display:     'block',
    textAlign:   'center',
  };

  return (
    <div style={{
      display:         'flex',
      border:          `1px solid ${T.border}`,
      borderRadius:    8,
      overflow:        'hidden',
      backgroundColor: T.elevated,
    }}>
      {/* ── Left controls panel ──────────────────────────────── */}
      <div style={{
        display:        'flex',
        flexDirection:  'column',
        gap:            8,
        padding:        '10px 10px',
        borderRight:    `1px solid ${T.border}`,
        minWidth:       112,
        justifyContent: 'flex-start',
      }}>
        <div>
          <span style={muteLabel}>{metric === 'ap' ? 'Max AP' : 'Max APE'}</span>
          <Scrubber
            value={manualMax}
            autoValue={autoMax}
            onChange={onManualMaxChange}
            disabled={isAuto}
          />
        </div>
        <div>
          <span style={muteLabel}>{metric === 'ap' ? 'Min AP' : 'Min APE'}</span>
          <Scrubber
            value={manualMin}
            autoValue={autoMin}
            onChange={onManualMinChange}
            disabled={isAuto}
          />
        </div>
        <div>
          <span style={muteLabel}>Colormap</span>
          <select value={scheme} onChange={e => onSchemeChange(e.target.value)} style={selectStyle}>
            {COLOR_SCHEME_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <input
            type="checkbox"
            id={`${gradId}-auto`}
            checked={isAuto}
            onChange={e => {
              if (e.target.checked) {
                onManualMinChange(null);
                onManualMaxChange(null);
              } else {
                // Lock current auto values as manual overrides (2 dp)
                onManualMinChange(round2(autoMin));
                onManualMaxChange(round2(autoMax));
              }
            }}
            style={{ cursor: 'pointer', accentColor: T.text, margin: 0 }}
          />
          <label
            htmlFor={`${gradId}-auto`}
            style={{ ...muteLabel, marginBottom: 0, cursor: 'pointer' }}
          >
            Automatic colormap range
          </label>
        </div>
      </div>

      {/* ── Right SVG chart ──────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ width: '100%', height: 'auto', display: 'block' }}
          onMouseLeave={() => onBinHover(null)}
        >
          <defs>
            <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
              {stops.map((s, i) => (
                <stop key={i} offset={s.offset} stopColor={s.color} />
              ))}
            </linearGradient>
          </defs>

          {/* Histogram bars */}
          {histBars.map((bar, i) => bar.h > 0 && (
            <rect
              key={i}
              x={bar.x + 0.3}
              y={GRAD_Y - bar.h}
              width={BIN_W - 0.6}
              height={bar.h}
              fill={i === (activeBin ?? hoveredBin) ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.18)'}
            />
          ))}


          {/* Gradient bar */}
          <rect
            x={PAD_L} y={GRAD_Y}
            width={CHART_W} height={GRAD_H}
            fill={`url(#${gradId})`}
            rx="2"
          />

          {/* End tick marks (at exact min/max) */}
          <line x1={PAD_L}           y1={BAR_BOT} x2={PAD_L}           y2={TICK_LG_Y2}
                stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" />
          <line x1={PAD_L + CHART_W} y1={BAR_BOT} x2={PAD_L + CHART_W} y2={TICK_LG_Y2}
                stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" />

          {/* Min / max edge labels — scrubable */}
          <g
            onMouseDown={makeScrubHandler(() => heatMin, onManualMinChange)}
            style={{ cursor: 'ew-resize', userSelect: 'none' }}
          >
            <text x={PAD_L} y={TICK_LABEL_Y} textAnchor="start" fontSize={T.sz.sm}>
              <tspan fill="rgba(255,255,255,0.25)">‹ </tspan>
              <tspan fill="rgba(255,255,255,0.55)">{heatMin.toFixed(1)}</tspan>
              <tspan fill="rgba(255,255,255,0.25)"> ›</tspan>
            </text>
          </g>
          <g
            onMouseDown={makeScrubHandler(() => heatMax, onManualMaxChange)}
            style={{ cursor: 'ew-resize', userSelect: 'none' }}
          >
            <text x={PAD_L + CHART_W} y={TICK_LABEL_Y} textAnchor="end" fontSize={T.sz.sm}>
              <tspan fill="rgba(255,255,255,0.25)">‹ </tspan>
              <tspan fill="rgba(255,255,255,0.55)">{heatMax.toFixed(1)}</tspan>
              <tspan fill="rgba(255,255,255,0.25)"> ›</tspan>
            </text>
          </g>

          {/* Interior axis ticks */}
          {axisTicks.map((t, i) => (
            <g key={i}>
              <line
                x1={t.x} y1={BAR_BOT}
                x2={t.x} y2={t.isWhole ? TICK_LG_Y2 : TICK_SM_Y2}
                stroke={t.isWhole ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)'}
                strokeWidth={t.isWhole ? 1.2 : 0.8}
              />
              {t.label !== null && (
                <text x={t.x} y={TICK_LABEL_Y}
                      textAnchor="middle" fontSize={T.sz.sm} fill="rgba(255,255,255,0.55)">
                  {t.label}
                </text>
              )}
            </g>
          ))}

          {/* Rug marks — below axis labels */}
          {rugXs.map((cx, i) => (
            <line
              key={i}
              x1={cx} y1={RUG_Y0}
              x2={cx} y2={RUG_Y1}
              stroke="rgba(255,255,255,0.35)"
              strokeWidth="0.8"
            />
          ))}

          {/* Metric label */}
          <text
            x={W / 2} y={AP_Y}
            textAnchor="middle" fontSize={T.sz.sm}
            fill="rgba(255,255,255,0.4)"
          >
            {metric === 'ap' ? 'AP' : metric.toUpperCase()}
          </text>

          {/* Invisible hit areas — rendered last so they sit on top of the histogram region */}
          {histBars.map((bar, i) => (
            <rect
              key={`hit-${i}`}
              x={bar.x}
              y={PAD_T}
              width={BIN_W}
              height={GRAD_Y - PAD_T}
              fill="transparent"
              onMouseEnter={() => onBinHover(i)}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
