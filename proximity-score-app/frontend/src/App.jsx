import { useState, useEffect, useMemo } from 'react';
import HeatText       from './HeatText';
import StatusBar      from './StatusBar';
import APDistribution from './APDistribution';
import { COLOR_SCHEME_NAMES } from './heatColor';
import { T } from './tokens';

// -- State -------------------------------------------------------------------
const EMPTY_PANEL = {
  text:         '',
  result:       null,
  loading:      false,
  error:        null,
  metric:       'ap',
  displayMode:  'readable',
  selectedChips: [],   // number[]
  chipAnchor:    null, // last plain-clicked index (for shift-click range)
  chipHistory:   [],   // [{chips, anchor}] stack for Ctrl+Z
};

function getGlobalBounds(panels) {
  const allValues = panels
    .filter(p => p.result && p.selectedChips.length === 0)
    .flatMap(p => p.result[p.metric]);
  if (allValues.length === 0) return { min: 0, max: 1 };
  return { min: Math.min(...allValues), max: Math.max(...allValues) };
}

function getLocalBounds(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max };
}

// -- Buttons -----------------------------------------------------------------
function WideButton({ onClick, disabled, children }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width:           '100%',
        appearance:      'none',
        WebkitAppearance:'none',
        fontFamily:      'inherit',
        fontSize:        T.sz.btn,
        fontWeight:      500,
        color:           disabled ? T.muted : T.text,
        background:      hovered && !disabled ? T.elevated : 'transparent',
        border:          `1px solid ${disabled ? T.faint : hovered ? T.borderHover : T.border}`,
        borderRadius:    8,
        padding:         '10px 0',
        cursor:          disabled ? 'not-allowed' : 'pointer',
        transition:      'background 150ms, border-color 150ms, color 150ms',
      }}
    >
      {children}
    </button>
  );
}

function GhostButton({ onClick, disabled, children, style: extraStyle }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        appearance:      'none',
        WebkitAppearance:'none',
        fontFamily:      'inherit',
        fontSize:        T.sz.ui,
        fontWeight:      500,
        color:           disabled ? T.muted : T.text,
        background:      hovered && !disabled ? T.elevated : 'transparent',
        border:          `1px solid ${disabled ? T.faint : hovered ? T.borderHover : T.border}`,
        borderRadius:    6,
        padding:         '5px 14px',
        cursor:          disabled ? 'not-allowed' : 'pointer',
        transition:      'background 150ms, border-color 150ms, color 150ms',
        whiteSpace:      'nowrap',
        ...extraStyle,
      }}
    >
      {children}
    </button>
  );
}

// -- Scalar pill -------------------------------------------------------------
function Pill({ label, value }) {
  return (
    <span style={styles.pill}>
      <span style={styles.pillLabel}>{label}</span>
      <span style={styles.pillValue}>{value}</span>
    </span>
  );
}

// -- Panel -------------------------------------------------------------------
function Panel({ panel, onChange, globalMin, globalMax, colorScheme, onColorSchemeChange,
                 gradientMin, gradientScale, heatFontSize,
                 manualMin, manualMax, onManualMinChange, onManualMaxChange }) {
  const { text, result, loading, error, metric, displayMode, selectedChips, chipAnchor, chipHistory } = panel;
  const [focused, setFocused] = useState(false);
  const [textCollapsed, setTextCollapsed] = useState(false);
  const [hoveredChip, setHoveredChip] = useState(null);
  const [hoveredBin,  setHoveredBin]  = useState(null);

  const CLEAR_SELECTION = { selectedChips: [], chipAnchor: null, chipHistory: [] };

  async function handleScore() {
    setTextCollapsed(true);
    onChange({ ...panel, loading: true, error: null, ...CLEAR_SELECTION });
    try {
      const res = await fetch('/score', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text }),
      });
      let data;
      try { data = await res.json(); }
      catch { throw new Error(`Backend not reachable or returned empty response (HTTP ${res.status})`); }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      onChange({ ...panel, result: data, loading: false, error: null, ...CLEAR_SELECTION });
    } catch (e) {
      onChange({ ...panel, loading: false, error: e.message, ...CLEAR_SELECTION });
    }
  }

  function handleExport() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const slug = result.text.trim().split(/\s+/).slice(0, 5).join('_').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    a.href = url; a.download = `${slug || 'proximity_score'}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  function handleSelectionChange(newChips, newAnchor) {
    onChange({
      ...panel,
      selectedChips: newChips,
      chipAnchor:    newAnchor,
      chipHistory:   [...chipHistory, { chips: selectedChips, anchor: chipAnchor }],
    });
  }

  // Compute heat values: average matrix rows for each selected chip,
  // then null out the selected positions (self/internal proximity excluded).
  const heatValues = result
    ? selectedChips.length === 0
      ? result[metric]
      : (() => {
          const N      = result.tokens.length;
          const sum    = new Array(N).fill(0);
          const selSet = new Set(selectedChips);
          for (const idx of selectedChips)
            result.matrix[idx].forEach((v, col) => { sum[col] += v; });
          return sum.map((v, i) => selSet.has(i) ? null : v / selectedChips.length);
        })()
    : null;

  const { min: autoMin, max: autoMax } = selectedChips.length > 0 && heatValues
    ? getLocalBounds(heatValues.filter(v => v !== null))
    : { min: globalMin, max: globalMax };

  const heatMin = manualMin !== null ? manualMin : autoMin;
  const heatMax = manualMax !== null ? manualMax : autoMax;

  const binHighlightedChips = useMemo(() => {
    if (hoveredBin === null || !heatValues) return null;
    const range = Math.max(heatMax - heatMin, 1e-10);
    const s = new Set();
    heatValues.forEach((v, i) => {
      if (v === null) return;
      const bin = Math.min(99, Math.max(0, Math.floor((v - heatMin) / range * 100)));
      if (bin === hoveredBin) s.add(i);
    });
    return s;
  }, [hoveredBin, heatValues, heatMin, heatMax]);

  const statusMessage = !result
    ? 'No result yet — paste text and press Score'
    : selectedChips.length === 0
      ? 'Showing attention proximity heatmap'
      : selectedChips.length === 1
        ? `Showing "${result.tokens[selectedChips[0]]}" relative heatmap`
        : `Showing relative heatmap for ${selectedChips.length} selected tokens`;

  const resetSelection = () => onChange({ ...panel, ...CLEAR_SELECTION });

  return (
    <div style={styles.panel}>
      {/* ── Collapsible input box ── */}
      <div style={{
        border:       `1px solid ${T.border}`,
        borderRadius: 8,
        overflow:     'hidden',
      }}>
        {/* Title bar */}
        <div
          onClick={() => setTextCollapsed(c => !c)}
          style={{
            display:         'flex',
            alignItems:      'center',
            justifyContent:  'space-between',
            padding:         '5px 10px',
            backgroundColor: T.elevated,
            cursor:          'pointer',
            userSelect:      'none',
            borderBottom:    textCollapsed ? 'none' : `1px solid ${T.border}`,
          }}
        >
          <span style={{ fontSize: T.sz.xs, fontWeight: 500, color: T.muted }}>Input</span>
          <span style={{ fontSize: T.sz.xs, color: T.muted, lineHeight: 1 }}>
            {textCollapsed ? '▶' : '▼'}
          </span>
        </div>

        {/* Textarea — hidden when collapsed */}
        {!textCollapsed && (
          <textarea
            value={text}
            onChange={e => onChange({ ...panel, text: e.target.value })}
            placeholder="Paste text here..."
            rows={6}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={e => {
              if (e.key !== 'Enter') return;
              if (e.shiftKey) {
                // Shift+Enter: insert newline at cursor
                e.preventDefault();
                const el = e.currentTarget;
                const start = el.selectionStart;
                const end   = el.selectionEnd;
                const newText = text.slice(0, start) + '\n' + text.slice(end);
                onChange({ ...panel, text: newText });
                requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 1; });
              } else {
                // Enter: score
                e.preventDefault();
                if (!loading && text.trim()) handleScore();
              }
            }}
            style={{
              ...styles.textarea,
              border:       'none',
              borderRadius: 0,
              outline:      'none',
            }}
          />
        )}
      </div>

      <div style={styles.controls}>
        <GhostButton
          onClick={handleScore}
          disabled={loading || !text.trim()}
          style={{ fontSize: T.sz.btn, padding: '7px 22px', fontWeight: 600 }}
        >
          {loading ? 'Scoring…' : 'Score'}
        </GhostButton>

        <label style={styles.label}>
          Metric&nbsp;
          <select value={metric} onChange={e => onChange({ ...panel, metric: e.target.value })} style={styles.select}>
            <option value="ap">AP</option>
            <option value="ape">APE</option>
          </select>
        </label>

        <label style={styles.label}>
          Display&nbsp;
          <select value={displayMode} onChange={e => onChange({ ...panel, displayMode: e.target.value })} style={styles.select}>
            <option value="readable">Readable</option>
            <option value="raw">Raw tokens</option>
          </select>
        </label>

        {result && (
          <GhostButton onClick={handleExport}>Export JSON</GhostButton>
        )}
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {result && (
        <div style={styles.pills}>
          <Pill label="AP" value={result.scalar_ap.toFixed(4)} />
          <Pill label="APE"    value={result.scalar_ape.toFixed(4)} />
          <Pill label="tokens" value={result.tokens.length} />
        </div>
      )}

      <StatusBar message={statusMessage} />

      {result && heatValues && (
        <APDistribution
          heatValues={heatValues}
          heatMin={heatMin}
          heatMax={heatMax}
          scheme={colorScheme}
          onSchemeChange={onColorSchemeChange}
          alpha={0.75}
          metric={metric}
          autoMin={autoMin}
          autoMax={autoMax}
          manualMin={manualMin}
          manualMax={manualMax}
          onManualMinChange={onManualMinChange}
          onManualMaxChange={onManualMaxChange}
          hoveredChip={hoveredChip}
          onBinHover={setHoveredBin}
          activeBin={hoveredBin}
        />
      )}

      {result && (
        <WideButton onClick={() => { onManualMinChange(null); onManualMaxChange(null); }} disabled={manualMin === null && manualMax === null}>
          Reset colormap ranges
        </WideButton>
      )}

      {result && (
        <WideButton onClick={resetSelection} disabled={selectedChips.length === 0}>
          Reset heatmap
        </WideButton>
      )}

      {result && heatValues && (
        <div style={{ ...styles.heatBox, fontSize: heatFontSize }}>
          <HeatText
            text={result.text}
            tokens={result.tokens}
            charSpans={result.char_spans}
            heatValues={heatValues}
            globalMin={heatMin}
            globalMax={heatMax}
            selectedChips={selectedChips}
            chipAnchor={chipAnchor}
            onSelectionChange={handleSelectionChange}
            onChipHover={setHoveredChip}
            binHighlightedChips={binHighlightedChips}
            displayMode={displayMode}
            scheme={colorScheme}
            alpha={0.75}
            gradientMin={gradientMin}
            gradientScale={gradientScale}
          />
        </div>
      )}

    </div>
  );
}

// -- App ---------------------------------------------------------------------
export default function App() {
  const [panels, setPanels]               = useState([{ ...EMPTY_PANEL }, { ...EMPTY_PANEL }]);
  const [colorScheme, setColorScheme]     = useState('Viridis');
  const [heatFontSize, setHeatFontSize]   = useState(32);
  const [lastModifiedIdx, setLastModifiedIdx] = useState(null);
  const [manualMin, setManualMin]         = useState(null);
  const [manualMax, setManualMax]         = useState(null);
  const [backendStatus, setBackendStatus] = useState('checking'); // 'checking' | 'online' | 'offline'

  useEffect(() => {
    let cancelled = false;
    async function ping() {
      try {
        const res = await fetch('/health', { signal: AbortSignal.timeout(2000) });
        if (!cancelled) setBackendStatus(res.ok ? 'online' : 'loading');
      } catch {
        if (!cancelled) setBackendStatus('offline');
      }
    }
    ping();
    const id = setInterval(ping, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const gradientMin   = 0.20;
  const gradientScale = 35;

  function updatePanel(i, updated) {
    setPanels(prev => prev.map((p, idx) => idx === i ? updated : p));
    // Track which panel last had its selection changed (for Ctrl+Z targeting)
    if (updated.selectedChips !== panels[i].selectedChips) {
      setLastModifiedIdx(i);
    }
  }

  // Ctrl+Z: undo last chip selection on the most recently modified panel
  useEffect(() => {
    function onKeyDown(e) {
      if (!((e.ctrlKey || e.metaKey) && e.key === 'z')) return;
      if (lastModifiedIdx === null) return;
      e.preventDefault();
      setPanels(prev => prev.map((p, i) => {
        if (i !== lastModifiedIdx || p.chipHistory.length === 0) return p;
        const snap = p.chipHistory[p.chipHistory.length - 1];
        return {
          ...p,
          selectedChips: snap.chips,
          chipAnchor:    snap.anchor,
          chipHistory:   p.chipHistory.slice(0, -1),
        };
      }));
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lastModifiedIdx, panels]);

  const { min: globalMin, max: globalMax } = getGlobalBounds(panels);

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <h1 style={styles.heading}>Proximity Score</h1>

        <label style={styles.label}>
          Text size&nbsp;
          <input
            type="range"
            min={12} max={64} step={1}
            value={heatFontSize}
            onChange={e => setHeatFontSize(Number(e.target.value))}
            style={{ cursor: 'pointer', accentColor: T.text }}
          />
          &nbsp;{heatFontSize}px
        </label>

        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            backgroundColor: backendStatus === 'online'  ? '#4ade80'
                           : backendStatus === 'offline' ? '#f87171'
                           : '#facc15',
          }} />
          <span style={{ fontSize: T.sz.ui, color: T.muted, whiteSpace: 'nowrap' }}>
            {backendStatus === 'online'   ? 'Backend ready'
           : backendStatus === 'offline'  ? 'Backend offline'
           : backendStatus === 'loading'  ? 'Loading model…'
           :                               'Checking…'}
          </span>
        </span>
      </div>

      <div style={styles.columns}>
        {panels.map((panel, i) => (
          <Panel
            key={i}
            panel={panel}
            onChange={updated => updatePanel(i, updated)}
            globalMin={globalMin}
            globalMax={globalMax}
            colorScheme={colorScheme}
            onColorSchemeChange={setColorScheme}
            gradientMin={gradientMin}
            gradientScale={gradientScale}
            heatFontSize={heatFontSize}
            manualMin={manualMin}
            manualMax={manualMax}
            onManualMinChange={setManualMin}
            onManualMaxChange={setManualMax}
          />
        ))}
      </div>
    </div>
  );
}

// -- Styles ------------------------------------------------------------------
const styles = {
  root: {
    fontFamily:      "'Geist', system-ui, sans-serif",
    backgroundColor: T.bg,
    color:           T.text,
    minHeight:       '100vh',
    padding:         24,
    boxSizing:       'border-box',
  },
  header: {
    display:      'flex',
    alignItems:   'center',
    gap:          20,
    marginBottom: 24,
  },
  heading: {
    margin:        0,
    fontSize:      18,
    fontWeight:    600,
    letterSpacing: '-0.3px',
    color:         T.text,
  },
  columns: {
    display:    'flex',
    gap:        24,
    alignItems: 'flex-start',
  },
  panel: {
    flex:            1,
    minWidth:        0,
    display:         'flex',
    flexDirection:   'column',
    gap:             8,
    border:          `1px solid ${T.border}`,
    borderRadius:    12,
    padding:         16,
    backgroundColor: T.surface,
  },
  textarea: {
    width:           '100%',
    fontFamily:      "'Geist', system-ui, sans-serif",
    fontSize:        T.sz.btn,
    lineHeight:      1.6,
    resize:          'vertical',
    boxSizing:       'border-box',
    padding:         12,
    backgroundColor: T.elevated,
    color:           T.text,
    border:          `1px solid ${T.border}`,
    borderRadius:    8,
    outline:         'none',
    transition:      'border-color 150ms',
  },
  controls: {
    display:    'flex',
    gap:        8,
    alignItems: 'center',
    flexWrap:   'wrap',
  },
  label: {
    fontSize:   T.sz.ui,
    fontWeight: 500,
    color:      T.muted,
    display:    'flex',
    alignItems: 'center',
    gap:        6,
  },
  select: {
    fontFamily:      "'Geist', system-ui, sans-serif",
    fontSize:        T.sz.ui,
    backgroundColor: T.elevated,
    color:           T.text,
    border:          `1px solid ${T.border}`,
    borderRadius:    6,
    padding:         '4px 8px',
    cursor:          'pointer',
    outline:         'none',
  },
  pills: {
    display:    'flex',
    gap:        6,
    flexWrap:   'wrap',
  },
  pill: {
    display:         'inline-flex',
    alignItems:      'center',
    gap:             6,
    backgroundColor: T.elevated,
    border:          `1px solid ${T.border}`,
    borderRadius:    20,
    padding:         '2px 10px',
    fontSize:        T.sz.pill,
  },
  pillLabel: {
    color:      T.muted,
    fontWeight: 500,
  },
  pillValue: {
    color:      T.text,
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
  },
  error: {
    fontSize: T.sz.ui,
    color:    '#f87171',
  },
  heatBox: {
    backgroundColor: T.heatBg,
    border:          `1px solid ${T.border}`,
    borderRadius:    8,
    padding:         16,
    color:           T.text,
  },
};
