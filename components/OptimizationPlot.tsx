import React from 'react';

interface Point {
  iteration: number;
  makespan: number;
}

interface OptimizationPlotProps {
  data: Point[];
  width?: number;
  height?: number;
}

export const OptimizationPlot: React.FC<OptimizationPlotProps> = ({ data, width = 400, height = 150 }) => {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center text-xs text-slate-600 border border-slate-800 rounded bg-slate-900/50" style={{ width, height }}>
        Waiting for data...
      </div>
    );
  }

  const padding = 20;
  const plotW = width - padding * 2;
  const plotH = height - padding * 2;

  const maxIter = Math.max(...data.map(d => d.iteration));
  const minMake = Math.min(...data.map(d => d.makespan));
  const maxMake = Math.max(...data.map(d => d.makespan));
  
  // Add a little buffer to Y axis
  const yMin = minMake * 0.95;
  const yMax = maxMake * 1.05;

  const points = data.map(d => {
    const x = padding + (d.iteration / maxIter) * plotW;
    const y = padding + plotH - ((d.makespan - yMin) / (yMax - yMin)) * plotH;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="relative border border-slate-800 rounded bg-slate-900/50 overflow-hidden shadow-inner">
      <svg width={width} height={height}>
        {/* Grid lines */}
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#334155" strokeWidth="1" />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#334155" strokeWidth="1" />
        
        {/* The Line */}
        <polyline
          points={points}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Labels */}
        <text x={padding - 5} y={padding} textAnchor="end" className="text-[10px] fill-slate-500">{Math.round(yMax)}</text>
        <text x={padding - 5} y={height - padding} textAnchor="end" className="text-[10px] fill-slate-500">{Math.round(yMin)}</text>
        <text x={width - padding} y={height - 5} textAnchor="end" className="text-[10px] fill-slate-500">{maxIter} iters</text>
      </svg>
      <div className="absolute top-2 right-2 text-[10px] text-blue-400 font-mono bg-slate-900/80 px-1 rounded">
        Current: {data[data.length-1].makespan}
      </div>
    </div>
  );
};