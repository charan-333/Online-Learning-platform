/** Minimal accessible SVG charts. Each chart also renders a visually hidden data table. */
export function BarChart({ data, max, label, unit = '' }: { data: { label: string; value: number | null }[]; max?: number; label: string; unit?: string }) {
  const W = 560;
  const H = 180;
  const pad = { l: 34, r: 8, t: 10, b: 36 };
  const m = max ?? Math.max(1, ...data.map((d) => d.value ?? 0));
  const bw = data.length ? (W - pad.l - pad.r) / data.length : 0;
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label}>
        <line className="axis" x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} />
        {[0, 0.5, 1].map((f) => (
          <text key={f} x={pad.l - 6} y={H - pad.b - f * (H - pad.t - pad.b) + 4} textAnchor="end">
            {Math.round(m * f)}
          </text>
        ))}
        {data.map((d, i) => {
          const h = ((d.value ?? 0) / m) * (H - pad.t - pad.b);
          return (
            <g key={i}>
              <rect className="bar" x={pad.l + i * bw + bw * 0.15} width={bw * 0.7} y={H - pad.b - h} height={Math.max(0, h)} rx={3} opacity={d.value === null ? 0.25 : 1} />
              <text x={pad.l + i * bw + bw / 2} y={H - pad.b + 14} textAnchor="middle">
                {d.label.length > 10 ? d.label.slice(0, 9) + '…' : d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <DataTable label={label} rows={data.map((d) => [d.label, d.value === null ? '—' : `${d.value}${unit}`])} />
    </figure>
  );
}

export function LineChart({ data, max, label, unit = '' }: { data: { label: string; value: number }[]; max?: number; label: string; unit?: string }) {
  const W = 560;
  const H = 180;
  const pad = { l: 34, r: 12, t: 10, b: 36 };
  const m = max ?? Math.max(1, ...data.map((d) => d.value));
  const x = (i: number) => pad.l + (data.length <= 1 ? (W - pad.l - pad.r) / 2 : (i / (data.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => H - pad.b - (v / m) * (H - pad.t - pad.b);
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label}>
        <line className="axis" x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} />
        {[0, 0.5, 1].map((f) => (
          <text key={f} x={pad.l - 6} y={y(m * f) + 4} textAnchor="end">
            {Math.round(m * f)}
          </text>
        ))}
        <polyline className="line" points={data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ')} />
        {data.map((d, i) => (
          <g key={i}>
            <circle className="dot" cx={x(i)} cy={y(d.value)} r={3.5} />
            <text x={x(i)} y={H - pad.b + 14} textAnchor="middle">
              {d.label}
            </text>
          </g>
        ))}
      </svg>
      <DataTable label={label} rows={data.map((d) => [d.label, `${d.value}${unit}`])} />
    </figure>
  );
}

function DataTable({ label, rows }: { label: string; rows: string[][] }) {
  return (
    <table className="sr-only">
      <caption>{label}</caption>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
