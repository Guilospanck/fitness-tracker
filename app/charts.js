// Minimal dependency-free line chart (SVG) for progression. Renders one metric
// over time. Returns an SVG element sized to its container width.
export function lineChart(points, { width = 320, height = 160, label = '' } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const pad = { top: 16, right: 12, bottom: 24, left: 40 };
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.classList.add('chart');

  const vals = points.map(p => p.y);
  if (!points.length) {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', width / 2);
    t.setAttribute('y', height / 2);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('class', 'chart-empty');
    t.textContent = 'No data yet';
    svg.appendChild(t);
    return svg;
  }

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const iw = width - pad.left - pad.right;
  const ih = height - pad.top - pad.bottom;

  const x = (i) => pad.left + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => pad.top + ih - ((v - min) / span) * ih;

  // y-axis min/max labels
  for (const [v, cls] of [[max, 'top'], [min, 'bot']]) {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', pad.left - 6);
    t.setAttribute('y', cls === 'top' ? pad.top + 4 : pad.top + ih);
    t.setAttribute('text-anchor', 'end');
    t.setAttribute('class', 'chart-axis');
    t.textContent = Math.round(v * 10) / 10;
    svg.appendChild(t);
  }

  // path
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  path.setAttribute('class', 'chart-line');
  svg.appendChild(path);

  // dots
  points.forEach((p, i) => {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', x(i));
    c.setAttribute('cy', y(p.y));
    c.setAttribute('r', 2.5);
    c.setAttribute('class', 'chart-dot');
    const title = document.createElementNS(ns, 'title');
    title.textContent = `${p.label}: ${Math.round(p.y * 10) / 10}`;
    c.appendChild(title);
    svg.appendChild(c);
  });

  if (label) {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', pad.left);
    t.setAttribute('y', 11);
    t.setAttribute('class', 'chart-label');
    t.textContent = label;
    svg.appendChild(t);
  }
  return svg;
}
