import { T } from './tokens';

export default function StatusBar({ message }) {
  return (
    <div style={styles.bar}>
      {message}
    </div>
  );
}

const styles = {
  bar: {
    fontSize:        T.sz.status,
    fontWeight:      500,
    color:           T.muted,
    backgroundColor: T.elevated,
    border:          `1px solid ${T.border}`,
    borderRadius:    6,
    padding:         '5px 12px',
    letterSpacing:   '0.02em',
    textAlign:       'center',
    userSelect:      'none',
    whiteSpace:      'nowrap',
    overflow:        'hidden',
    textOverflow:    'ellipsis',
  },
};
