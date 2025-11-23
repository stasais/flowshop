import React, { useMemo } from 'react';
import { TaskLog, Instance } from '../types';

interface GanttChartProps {
  schedule: TaskLog[];
  instance: Instance;
  makespan: number;
}

const COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', 
  '#ec4899', '#06b6d4', '#84cc16', '#d946ef', '#f97316'
];

export const GanttChart: React.FC<GanttChartProps> = ({ schedule, instance, makespan }) => {
  const rowHeight = 20; // Reduced from 40
  const headerHeight = 20; // Reduced from 30
  const barPadding = 2; // Reduced from 6
  const sideWidth = 60; // Reduced from 80
  
  // Calculate total machines (rows)
  const totalMachines = useMemo(() => 
    instance.machinesPerStage.reduce((a, b) => a + b, 0), 
  [instance]);

  const height = totalMachines * rowHeight + headerHeight + 30; // +30 for axis
  
  // Dynamic width based on makespan, min 800px
  // Scale: 1 unit time = X pixels. Let's target ~1000px width for the chart area.
  const chartWidth = 1000;
  const scaleX = makespan > 0 ? chartWidth / (makespan * 1.1) : 1; 

  // Generate Y-axis labels
  const machineLabels = useMemo(() => {
    const labels = [];
    let globalIdx = 0;
    for (let s = 0; s < instance.numStages; s++) {
      for (let m = 0; m < instance.machinesPerStage[s]; m++) {
        labels.push({ id: globalIdx, label: `S${s+1}-M${m+1}`, y: globalIdx * rowHeight + headerHeight });
        globalIdx++;
      }
    }
    return labels;
  }, [instance]);

  return (
    <div className="overflow-x-auto border border-slate-800 rounded-lg bg-slate-900 shadow-xl">
      <div style={{ width: sideWidth + chartWidth + 40, height }} className="relative">
        
        <svg width={sideWidth + chartWidth + 40} height={height} className="block">
          
          {/* Background Grid */}
          <rect x={sideWidth} y={0} width={chartWidth} height={height} fill="#0f172a" />
          
          {/* Rows Alternating Background */}
          {machineLabels.map((ml, i) => (
            <rect 
              key={`bg-${i}`}
              x={0} 
              y={ml.y} 
              width={sideWidth + chartWidth + 40} 
              height={rowHeight} 
              fill={i % 2 === 0 ? '#1e293b' : '#0f172a'} 
              opacity={0.5}
            />
          ))}

          {/* Y Axis Labels */}
          {machineLabels.map((ml) => (
            <text
              key={`label-${ml.id}`}
              x={sideWidth - 5}
              y={ml.y + rowHeight / 2}
              textAnchor="end"
              dominantBaseline="middle"
              className="text-[10px] fill-slate-400 font-mono"
            >
              {ml.label}
            </text>
          ))}

          {/* Time Axis (Bottom) */}
          <line x1={sideWidth} y1={height - 20} x2={sideWidth + chartWidth} y2={height - 20} stroke="#475569" />
          {Array.from({ length: 11 }).map((_, i) => {
            const timeVal = (makespan * 1.1) * (i / 10);
            const xPos = sideWidth + timeVal * scaleX;
            return (
              <g key={`tick-${i}`}>
                <line x1={xPos} y1={headerHeight} x2={xPos} y2={height - 20} stroke="#334155" strokeDasharray="2,4" />
                <text x={xPos} y={height - 5} textAnchor="middle" className="text-[9px] fill-slate-500">
                  {Math.round(timeVal)}
                </text>
              </g>
            );
          })}

          {/* Tasks */}
          {schedule.map((task, i) => {
            const x = sideWidth + task.startTime * scaleX;
            const w = (task.endTime - task.startTime) * scaleX;
            const y = headerHeight + task.globalMachineId * rowHeight + barPadding;
            const h = rowHeight - barPadding * 2;
            const color = COLORS[task.jobId % COLORS.length];

            return (
              <g key={`task-${i}`} className="group cursor-pointer">
                <rect
                  x={x}
                  y={y}
                  width={Math.max(w, 1)}
                  height={h}
                  fill={color}
                  rx={2}
                  className="opacity-90 hover:opacity-100 transition-opacity stroke-slate-900"
                  strokeWidth={0.5}
                />
                <text
                  x={x + w / 2}
                  y={y + h / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="text-[8px] fill-white font-bold pointer-events-none"
                >
                  J{task.jobId}
                </text>
                
                {/* Tooltip hint via title (simple) - custom tooltip overlay would be better but complex for single file constraint */}
                <title>{`Job ${task.jobId}\nStage ${task.stageId + 1}\nStart: ${task.startTime}\nEnd: ${task.endTime}\nDuration: ${task.endTime - task.startTime}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
