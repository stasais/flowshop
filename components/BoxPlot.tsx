import React, { useMemo } from 'react';

interface BoxPlotProps {
  data: Record<string, number[]>;
  width?: number;
  height?: number;
}

interface Stats {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers: number[];
}

const calculateStats = (values: number[]): Stats | null => {
  if (values.length === 0) return null;
  
  const sorted = [...values].sort((a, b) => a - b);
  
  const q1Pos = (sorted.length - 1) * 0.25;
  const q3Pos = (sorted.length - 1) * 0.75;
  const medianPos = (sorted.length - 1) * 0.5;

  const getVal = (pos: number) => {
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    } else {
      return sorted[base];
    }
  };

  const q1 = getVal(q1Pos);
  const q3 = getVal(q3Pos);
  const median = getVal(medianPos);
  const iqr = q3 - q1;
  
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  return { min, q1, median, q3, max, outliers: [] };
};

export const BoxPlot: React.FC<BoxPlotProps> = ({ data, width = 600, height = 300 }) => {
  const padding = { top: 20, right: 30, bottom: 40, left: 60 };
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;

  const dataset = useMemo(() => {
    const keys = Object.keys(data);
    const result = keys.map(key => ({
      key,
      stats: calculateStats(data[key])
    })).filter(d => d.stats !== null);
    return result;
  }, [data]);

  const yDomain = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    dataset.forEach(d => {
      if (d.stats) {
        if (d.stats.min < min) min = d.stats.min;
        if (d.stats.max > max) max = d.stats.max;
      }
    });
    if (min === Infinity) return { min: 0, max: 100 };
    // Add buffer
    const buffer = (max - min) * 0.1;
    return { min: Math.max(0, min - buffer), max: max + buffer };
  }, [dataset]);

  const yScale = (val: number) => {
    const range = yDomain.max - yDomain.min;
    if (range === 0) return graphHeight / 2;
    return graphHeight - ((val - yDomain.min) / range) * graphHeight;
  };

  if (dataset.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-slate-600 border border-slate-800 rounded bg-slate-900/50" style={{ width, height }}>
        No comparison data available yet. Run algorithms to see distribution.
      </div>
    );
  }

  const boxWidth = Math.min(60, graphWidth / dataset.length / 2);

  return (
    <div className="relative border border-slate-800 rounded bg-slate-900/50 overflow-hidden shadow-inner">
      <svg width={width} height={height}>
        <g transform={`translate(${padding.left}, ${padding.top})`}>
          
          {/* Y Axis Grid & Labels */}
          {Array.from({ length: 6 }).map((_, i) => {
            const val = yDomain.min + (i / 5) * (yDomain.max - yDomain.min);
            const y = yScale(val);
            return (
              <g key={`grid-${i}`}>
                <line x1={0} y1={y} x2={graphWidth} y2={y} stroke="#334155" strokeWidth="1" strokeDasharray="4,4" opacity={0.3} />
                <text x={-10} y={y} textAnchor="end" dominantBaseline="middle" className="text-[10px] fill-slate-500">
                  {Math.round(val)}
                </text>
              </g>
            );
          })}
          
          {/* Axis Lines */}
          <line x1={0} y1={0} x2={0} y2={graphHeight} stroke="#475569" />
          <line x1={0} y1={graphHeight} x2={graphWidth} y2={graphHeight} stroke="#475569" />

          {/* Plots */}
          {dataset.map((d, i) => {
            const center = (i + 0.5) * (graphWidth / dataset.length);
            const s = d.stats!;
            const color = d.key === 'Random' ? '#94a3b8' : 
                          d.key === 'GA' ? '#3b82f6' : 
                          d.key === 'SA' ? '#ec4899' : '#10b981';

            return (
              <g key={d.key}>
                {/* Whisker Line */}
                <line x1={center} y1={yScale(s.min)} x2={center} y2={yScale(s.max)} stroke={color} strokeWidth={2} />
                
                {/* Whisker Caps */}
                <line x1={center - boxWidth/2} y1={yScale(s.min)} x2={center + boxWidth/2} y2={yScale(s.min)} stroke={color} strokeWidth={2} />
                <line x1={center - boxWidth/2} y1={yScale(s.max)} x2={center + boxWidth/2} y2={yScale(s.max)} stroke={color} strokeWidth={2} />

                {/* Box */}
                <rect 
                  x={center - boxWidth/2} 
                  y={yScale(s.q3)} 
                  width={boxWidth} 
                  height={Math.max(2, yScale(s.q1) - yScale(s.q3))} 
                  fill={color} 
                  fillOpacity={0.2} 
                  stroke={color} 
                  strokeWidth={2}
                />

                {/* Median Line */}
                <line 
                  x1={center - boxWidth/2} 
                  y1={yScale(s.median)} 
                  x2={center + boxWidth/2} 
                  y2={yScale(s.median)} 
                  stroke="#ffffff" 
                  strokeWidth={2} 
                  strokeDasharray="2,2"
                />

                {/* X Label */}
                <text x={center} y={graphHeight + 20} textAnchor="middle" className="text-xs font-bold fill-slate-300">
                  {d.key}
                </text>
                
                {/* Value Label (Top) */}
                <text x={center} y={yScale(s.max) - 10} textAnchor="middle" className="text-[10px] fill-slate-500">
                   Best: {s.min}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute top-2 right-2 text-[10px] text-slate-500 bg-slate-900/80 px-2 py-1 rounded border border-slate-800">
        Top 10 Distribution (Lower is Better)
      </div>
    </div>
  );
};