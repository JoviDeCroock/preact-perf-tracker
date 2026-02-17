import { useMemo, useState } from 'preact/hooks';

function ExpensiveList({ seed }: { seed: number }) {
  const items = useMemo(() => {
    return Array.from({ length: 300 }, (_, i) => (i * seed) % 97).sort(
      (a, b) => a - b,
    );
  }, [seed]);

  return (
    <ul>
      {items.slice(0, 25).map((value, idx) => (
        <li key={`${value}-${idx}`}>{value}</li>
      ))}
    </ul>
  );
}

export function App() {
  const [count, setCount] = useState(0);
  const [seed, setSeed] = useState(7);
  const [label, setLabel] = useState('tracker-demo');

  return (
    <main style={{ fontFamily: 'sans-serif', maxWidth: 700, margin: '2rem auto' }}>
      <h1>preact-perf-tracker example</h1>
      <p>Use the buttons below and watch overlay + toolbar updates.</p>

      <section style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button onClick={() => setCount((c) => c + 1)}>Increment: {count}</button>
        <button onClick={() => setSeed((s) => s + 1)}>Shuffle list</button>
        <button onClick={() => setLabel((l) => `${l}!`)}>Change label</button>
      </section>

      <p>Label: {label}</p>
      <ExpensiveList seed={seed} />
    </main>
  );
}
