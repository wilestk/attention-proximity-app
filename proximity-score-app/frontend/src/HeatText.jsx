import { useRef, useLayoutEffect, useState, useMemo, useEffect } from 'react';
import { heatToColor } from './heatColor';
import './HeatText.css';

function normalize(values, globalMin, globalMax) {
  const range = globalMax - globalMin;
  if (range === 0) return values.map(v => v === null ? null : 0.5);
  return values.map(v => v === null ? null : (v - globalMin) / range);
}

export default function HeatText({
  text,
  tokens,
  charSpans,
  heatValues,
  globalMin,
  globalMax,
  selectedChips       = [],
  chipAnchor          = null,
  onSelectionChange   = () => {},
  onChipHover         = () => {},
  binHighlightedChips = null,
  displayMode         = 'readable',
  scheme              = 'Blue-White-Red',
  alpha               = 0.75,
  gradientMin         = 0.2,
  gradientScale       = 35,
}) {
  const containerRef = useRef(null);
  const measureRef   = useRef(null);

  const [containerWidth, setContainerWidth] = useState(0);
  const [tokenWidths,    setTokenWidths]    = useState(null);

  // --- Drag tracking via refs (synchronous, no closure-staleness issues) -------
  // mouseIsDown / dragStartRef / dragCurrentRef track state across async events.
  // dragCommittedRef: set true in mouseup when a real drag commits; onClick reads
  // it to skip (mouseup fires before click in the native event order).
  // chipAnchorRef: mirrors the chipAnchor prop so onClick always reads live value.
  const mouseIsDown        = useRef(false);
  const dragStartRef       = useRef(null);
  const dragCurrentRef     = useRef(null);
  const dragCommittedRef   = useRef(false);
  const chipAnchorRef      = useRef(chipAnchor);
  const selectedChipsRef   = useRef(selectedChips);
  const selectedSetRef     = useRef(new Set(selectedChips));

  const binHighlightedChipsRef = useRef(null);

  useEffect(() => { chipAnchorRef.current        = chipAnchor;              }, [chipAnchor]);
  useEffect(() => { selectedChipsRef.current      = selectedChips;           }, [selectedChips]);
  useEffect(() => { selectedSetRef.current        = new Set(selectedChips);  }, [selectedChips]);
  useEffect(() => { binHighlightedChipsRef.current = binHighlightedChips;    }, [binHighlightedChips]);

  // dragRange drives the visual marching-ants preview while dragging
  const [dragRange, setDragRange] = useState(null); // [lo, hi] | null

  // --- Derived data -----------------------------------------------------------
  const normalized = normalize(heatValues, globalMin, globalMax);

  const displayTexts = useMemo(() =>
    tokens.map((tok, i) =>
      displayMode === 'readable'
        ? text.slice(charSpans[i][0], charSpans[i][1]).replace(/\n/g, '')
        : tok
    ),
    [tokens, charSpans, text, displayMode]
  );

  const hasNewline = useMemo(() =>
    charSpans.map(([s, e]) => text.slice(s, e).includes('\n')),
    [charSpans, text]
  );

  const wordGroups = useMemo(() => {
    const g = new Array(tokens.length).fill(0);
    let id = 0;
    for (let i = 0; i < tokens.length; i++) {
      if (i > 0 && (/^\s/.test(displayTexts[i]) || hasNewline[i - 1])) id++;
      g[i] = id;
    }
    return g;
  }, [tokens, displayTexts, hasNewline]);

  const SPACE_PAD = 5;
  const tokenPaddings = useMemo(() =>
    displayTexts.map(d => ({
      left:  /^\s/.test(d) ? SPACE_PAD : 0,
      right: /\s$/.test(d) ? SPACE_PAD : 0,
    })),
    [displayTexts]
  );

  // Committed selection set (O(1) lookup)
  const selectedSet = useMemo(() => new Set(selectedChips), [selectedChips]);

  // Effective selection: replace with drag range while dragging
  const effectiveSet = useMemo(() => {
    if (!dragRange) return selectedSet;
    const [lo, hi] = dragRange;
    const s = new Set();
    for (let i = lo; i <= hi; i++) s.add(i);
    return s;
  }, [dragRange, selectedSet]);

  // --- Global mouseup: commit drag if mouse moved to a different chip ----------
  useEffect(() => {
    function onMouseUp() {
      if (!mouseIsDown.current) return;
      mouseIsDown.current = false;

      const start   = dragStartRef.current;
      const current = dragCurrentRef.current;
      dragStartRef.current   = null;
      dragCurrentRef.current = null;

      if (start !== null && current !== null && start !== current) {
        // Real cross-chip drag — commit it
        const lo    = Math.min(start, current);
        const hi    = Math.max(start, current);
        const range = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
        onSelectionChange(range, start);
        dragCommittedRef.current = true; // tell onClick to skip
      }
      setDragRange(null);
    }
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [onSelectionChange]);

  // --- Layout -----------------------------------------------------------------
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(entries => {
      setContainerWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el || containerWidth === 0) return;
    const widths = Array.from(el.children).map(
      span => span.getBoundingClientRect().width
    );
    setTokenWidths(widths);
  }, [displayTexts, containerWidth]);

  const lines = useMemo(() => {
    if (!tokenWidths || containerWidth === 0) return null;
    const result       = [];
    let   currentLine  = [];
    let   currentWidth = 0;

    for (let i = 0; i < tokens.length; i++) {
      const w = tokenWidths[i];
      if (currentLine.length > 0 && currentWidth + w > containerWidth) {
        result.push(currentLine);
        currentLine  = [i];
        currentWidth = w;
      } else {
        currentLine.push(i);
        currentWidth += w;
      }
      if (hasNewline[i]) {
        result.push(currentLine);
        currentLine  = [];
        currentWidth = 0;
      }
    }
    if (currentLine.length > 0) result.push(currentLine);
    return result;
  }, [tokenWidths, containerWidth, tokens, hasNewline]);

  // --- Render -----------------------------------------------------------------
  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', fontFamily: 'inherit', fontSize: 'inherit' }}
    >
      {/* Hidden measurement layer */}
      <div
        ref={measureRef}
        style={{
          position:      'absolute',
          visibility:    'hidden',
          whiteSpace:    'pre',
          fontFamily:    'inherit',
          fontSize:      'inherit',
          lineHeight:    'inherit',
          top:           0,
          left:          0,
          pointerEvents: 'none',
          overflow:      'hidden',
          maxWidth:      '100%',
        }}
      >
        {displayTexts.map((d, i) => (
          <span key={i} style={{
            border:       '1px solid transparent',
            borderRadius: 4,
            paddingLeft:  tokenPaddings[i].left,
            paddingRight: tokenPaddings[i].right,
          }}>{d}</span>
        ))}
      </div>

      {/* Computed layout */}
      {lines && lines.map((lineTokens, li) => (
        <div key={li} style={{ display: 'flex', flexWrap: 'nowrap', lineHeight: 1.7 }}>
          {lineTokens.map(i => {
            if (displayTexts[i].length === 0) return null;

            const isSelected     = effectiveSet.has(i);
            const isBinHighlight = binHighlightedChips?.has(i) ?? false;
            const isNull         = normalized[i] === null;
            const bg             = isNull ? 'transparent' : heatToColor(normalized[i], scheme, alpha);

            return (
              <button
                key={i}
                className={isSelected ? 'chip-selected' : ''}
                title={isNull ? tokens[i] : `${tokens[i]}  score: ${heatValues[i].toFixed(4)}`}
                onMouseDown={e => {
                  e.preventDefault();            // block browser text-select drag
                  mouseIsDown.current      = true;
                  dragStartRef.current     = i;
                  dragCurrentRef.current   = i;
                  dragCommittedRef.current = false;
                }}
                onMouseEnter={e => {
                  onChipHover(i);
                  if (!isSelected) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.90)';
                  if (mouseIsDown.current && i !== dragStartRef.current) {
                    // Mouse moved to a different chip while held — show preview
                    dragCurrentRef.current = i;
                    const lo = Math.min(dragStartRef.current, i);
                    const hi = Math.max(dragStartRef.current, i);
                    setDragRange([lo, hi]);
                  }
                }}
                onMouseLeave={e => {
                  onChipHover(null);
                  if (!isSelected && !binHighlightedChipsRef.current?.has(i))
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
                }}
                onClick={e => {
                  // If a real drag was committed in mouseup, skip this click
                  if (dragCommittedRef.current) {
                    dragCommittedRef.current = false;
                    return;
                  }
                  const anchor = chipAnchorRef.current;
                  const chips  = selectedChipsRef.current;
                  const set    = selectedSetRef.current;

                  const ctrl = e.ctrlKey || e.metaKey;

                  if (e.shiftKey && anchor !== null) {
                    // Shift-click: range from anchor to i
                    const lo    = Math.min(anchor, i);
                    const hi    = Math.max(anchor, i);
                    const range = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
                    if (ctrl) {
                      // Ctrl+Shift: add range to existing selection
                      const merged = Array.from(new Set([...chips, ...range]));
                      onSelectionChange(merged, anchor);
                    } else {
                      // Shift only: replace with range
                      onSelectionChange(range, anchor);
                    }
                  } else if (ctrl) {
                    // Ctrl-click: toggle this chip in/out of existing selection
                    const next = set.has(i)
                      ? chips.filter(x => x !== i)
                      : [...chips, i];
                    onSelectionChange(next, i);
                  } else {
                    // Plain click: deselect if already the sole selected chip, otherwise select it
                    if (chips.length === 1 && chips[0] === i) {
                      onSelectionChange([], null);
                    } else {
                      onSelectionChange([i], i);
                    }
                  }
                }}
                onDoubleClick={e => {
                  const wg   = wordGroups[i];
                  const word = tokens.map((_, j) => j).filter(j => wordGroups[j] === wg);
                  const ctrl = e.ctrlKey || e.metaKey;
                  if (ctrl) {
                    // Ctrl+dblclick: add word to existing selection
                    const merged = Array.from(new Set([...selectedChipsRef.current, ...word]));
                    onSelectionChange(merged, i);
                  } else {
                    // Plain dblclick: replace with word
                    onSelectionChange(word, i);
                  }
                }}
                style={{
                  appearance:      'none',
                  WebkitAppearance:'none',
                  font:            'inherit',
                  margin:          0,
                  outline:         'none',
                  boxShadow:       'none',
                  cursor:          'pointer',
                  userSelect:      'none',
                  display:         'inline',
                  whiteSpace:      'pre',
                  paddingTop:      0,
                  paddingBottom:   0,
                  paddingLeft:     tokenPaddings[i].left,
                  paddingRight:    tokenPaddings[i].right,
                  // Use backgroundColor (not background shorthand) so the CSS
                  // class's backgroundImage for marching ants is not clobbered
                  backgroundColor: isSelected ? 'transparent' : bg,
                  border:          `2px solid ${isSelected ? 'transparent' : isBinHighlight ? 'rgba(255,255,255,0.90)' : 'rgba(255,255,255,0.12)'}`,
                  borderRadius:    4,
                  color:           'white',
                  fontWeight:      'normal',
                  textShadow:      '0 0 2px rgba(0,0,0,0.9)',
                  transition:      'border-color 150ms ease',
                }}
              >
                {displayTexts[i]}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
