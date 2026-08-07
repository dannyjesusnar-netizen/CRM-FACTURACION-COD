// Circulitos, cuadrados y "+" decorativos que flotan suavemente — usado en
// las pantallas más "de bienvenida" de la plataforma (Login, Menú
// principal) para darles un aire consistente entre sí.
const DEFAULT_SHAPES = [
  { type: 'dot', top: '12%', left: '10%', size: 14, color: '#fbbf24', delay: '0s' },
  { type: 'square', top: '20%', left: '82%', size: 18, color: '#6366f1', delay: '0.3s' },
  { type: 'plus', top: '48%', left: '88%', size: 16, color: '#fbbf24', delay: '0.9s' },
  { type: 'dot', top: '72%', left: '15%', size: 10, color: '#6366f1', delay: '0.6s' },
  { type: 'plus', top: '82%', left: '68%', size: 14, color: '#22c55e', delay: '0.2s' },
  { type: 'dot', top: '38%', left: '92%', size: 8, color: '#22c55e', delay: '1.1s' },
  { type: 'square', top: '86%', left: '38%', size: 14, color: '#fbbf24', delay: '0.5s' },
  { type: 'dot', top: '58%', left: '6%', size: 9, color: '#f472b6', delay: '0.8s' },
];

export default function FloatingShapes({ shapes = DEFAULT_SHAPES }) {
  return (
    <>
      {shapes.map((s, i) => (
        <span
          key={i}
          className={`floating-shape ${s.type}`}
          style={{
            top: s.top, left: s.left, width: s.size, height: s.size,
            color: s.color, animationDelay: s.delay,
          }}
        />
      ))}
    </>
  );
}
