import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Activity, Play, Zap, RotateCcw, BarChart3, ChevronLeft, ChevronRight, Info, Trash2, TrendingDown, Settings } from 'lucide-react';
import { 
  parseInstanceData, 
  generateRandomPermutation, 
  calculateSchedule, 
  runGeneticAlgorithmStep, 
  runSimulatedAnnealingStep, 
  runHillClimbingStep 
} from './services/simulation';
import { GanttChart } from './components/GanttChart';
import { OptimizationPlot } from './components/OptimizationPlot';
import { BoxPlot } from './components/BoxPlot';
import { Instance, ScheduleResult, OptimizationState, AlgorithmType, AlgorithmParams } from './types';

const DEFAULT_INSTANCE_TEXT = `10 5
3 3 2 3 3
5 46 90 18 18 83 96 34 33 40
6 20 20 68 90 49 81 97 57 28
55 85 87 78 60 39 50 58 94 25
35 72 27 48 24 15 87 23 21 95
77 41 52 70 48 8 63 22 67 69`;

const ALGO_INFO = {
  'GA': "Evolutionary algorithm. Uses a population of solutions, crossover (breeding), and mutation to evolve better schedules over generations.",
  'SA': "Probabilistic technique (Physics). Accepts worse solutions initially (high temp) to escape local optima, then 'cools down' to converge.",
  'HC': "Local Search. Iteratively makes small changes (swaps). Only accepts changes that improve the makespan. Fast but can get stuck in local optima.",
  'SimPy': "Python-based Discrete Event Simulation using SimPy library. Runs on backend.",
  'Mesa': "Python-based Agent-Based Modeling using Mesa library. Runs on backend.",
  'Salabim': "Python-based Discrete Event Simulation using Salabim library. Runs on backend."
};

const DEFAULT_PARAMS: AlgorithmParams = {
  gaPopulationSize: 20,
  gaMutationRate: 0.2,
  gaTournamentSize: 3,
  gaElitismCount: 2,
  saInitialTemp: 1000,
  saCoolingRate: 0.03,
  maxIterations: 200,
  randomSeed: 42
};

const App: React.FC = () => {
  const [inputText, setInputText] = useState(DEFAULT_INSTANCE_TEXT);
  const [instance, setInstance] = useState<Instance | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Settings
  const [params, setParams] = useState<AlgorithmParams>(DEFAULT_PARAMS);
  const [activeTab, setActiveTab] = useState<'simulation' | 'settings'>('simulation');

  // Results History
  const [schedules, setSchedules] = useState<ScheduleResult[]>([]);
  const [viewIndex, setViewIndex] = useState<number>(0);
  
  // Stats tracking for Box Plot
  const [comparisonHistory, setComparisonHistory] = useState<Record<string, number[]>>({
    'Random': [],
    'GA': [],
    'SA': [],
    'HC': [],
    'SimPy': [],
    'Mesa': [],
    'Salabim': []
  });

  // Optimization State
  const [optState, setOptState] = useState<OptimizationState>({
    bestMakespan: Infinity,
    currentIteration: 0,
    maxIterations: 200,
    isRunning: false,
    history: [],
    algorithm: 'GA'
  });

  // Algorithm Internals Refs
  const populationRef = useRef<number[][]>([]); // For GA
  const currentPermRef = useRef<number[]>([]);  // For SA/HC
  const tempRef = useRef<number>(1000);         // For SA
  const requestRef = useRef<number>();

  // Init
  useEffect(() => {
    try {
      const inst = parseInstanceData(inputText);
      setInstance(inst);
      setError(null);
      resetApp();
    } catch (e: any) {
      setError(e.message);
      setInstance(null);
    }
  }, [inputText]);

  const resetApp = () => {
    setSchedules([]);
    setViewIndex(0);
    setOptState(prev => ({ 
      ...prev, 
      bestMakespan: Infinity, 
      currentIteration: 0, 
      history: [],
      isRunning: false
    }));
    setComparisonHistory({ 'Random': [], 'GA': [], 'SA': [], 'HC': [], 'SimPy': [], 'Mesa': [], 'Salabim': [] });
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
  };

  const updateComparisonHistory = (algo: string, results: ScheduleResult[]) => {
    // Append new results to history and keep top 10 makespans
    setComparisonHistory(prev => {
      const currentList = prev[algo] || [];
      const newMakespans = results.map(s => s.makespan);
      const combined = [...currentList, ...newMakespans].sort((a, b) => a - b).slice(0, 10);
      return {
        ...prev,
        [algo]: combined
      };
    });
  };

  const handleRunRandom = () => {
    if (!instance) return;
    stopOptimization(); 
    
    const newSchedules: ScheduleResult[] = [];
    for (let i = 0; i < 10; i++) {
      const perm = generateRandomPermutation(instance.numJobs);
      const res = calculateSchedule(instance, perm);
      newSchedules.push(res);
    }

    // Sort by makespan (best first)
    newSchedules.sort((a, b) => a.makespan - b.makespan);
    
    setSchedules(newSchedules);
    setViewIndex(0);
    
    // Update comparison stats
    updateComparisonHistory('Random', newSchedules);
    
    setOptState(prev => ({
      ...prev,
      history: [{ iteration: 0, makespan: newSchedules[0].makespan }],
      bestMakespan: newSchedules[0].makespan
    }));
  };

  const runRemoteSimulation = async (algo: string) => {
    if (!instance) return;
    setOptState(prev => ({ ...prev, isRunning: true, history: [], bestMakespan: Infinity }));
    setSchedules([]);
    
    try {
      const endpoint = algo.toLowerCase();
      // Merge instance data with current parameters
      const payload = {
        ...instance,
        ...params
      };

      const response = await fetch(`/api/optimize/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) throw new Error('Simulation failed');
      
      const result: ScheduleResult = await response.json();
      
      setSchedules([result]);
      setViewIndex(0);
      setOptState(prev => ({
        ...prev,
        bestMakespan: result.makespan,
        history: [{ iteration: 1, makespan: result.makespan }],
        isRunning: false
      }));
      
      updateComparisonHistory(algo, [result]);
      
    } catch (e: any) {
      console.error(e);
      setError("Remote simulation failed. Ensure backend is running. " + e.message);
      setOptState(prev => ({ ...prev, isRunning: false }));
    }
  };

  const startOptimization = () => {
    if (!instance) return;

    if (['SimPy', 'Mesa', 'Salabim'].includes(optState.algorithm)) {
        runRemoteSimulation(optState.algorithm);
        return;
    }
    
    if (optState.algorithm === 'GA') {
      const pop: number[][] = [];
      for (let i = 0; i < params.gaPopulationSize; i++) pop.push(generateRandomPermutation(instance.numJobs));
      populationRef.current = pop;
    } else {
      currentPermRef.current = generateRandomPermutation(instance.numJobs);
      if (optState.algorithm === 'SA') tempRef.current = params.saInitialTemp;
    }
    
    setOptState(prev => ({ 
      ...prev, 
      isRunning: true, 
      currentIteration: 0, 
      history: [],
      bestMakespan: Infinity,
      maxIterations: params.maxIterations
    }));
    setSchedules([]); 
    
    loopOptimization();
  };

  const stopOptimization = () => {
    setOptState(prev => {
        // When stopping, add the best result found in this run to the history
        if (prev.isRunning && prev.bestMakespan !== Infinity) {
            setTimeout(() => {
                setComparisonHistory(h => {
                    const currentList = h[prev.algorithm] || [];
                    const combined = [...currentList, prev.bestMakespan].sort((a, b) => a - b).slice(0, 10);
                    return { ...h, [prev.algorithm]: combined };
                });
            }, 0);
        }
        return { ...prev, isRunning: false };
    });
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
  };

  const loopOptimization = () => {
    if (!instance) return;

    setOptState(prev => {
      if (prev.currentIteration >= prev.maxIterations || !prev.isRunning) {
        // Finished naturally
        if (prev.isRunning && prev.bestMakespan !== Infinity) {
             setTimeout(() => {
                setComparisonHistory(h => {
                    const currentList = h[prev.algorithm] || [];
                    const combined = [...currentList, prev.bestMakespan].sort((a, b) => a - b).slice(0, 10);
                    return { ...h, [prev.algorithm]: combined };
                });
            }, 0);
        }
        return { ...prev, isRunning: false };
      }

      let bestMake = Infinity;
      let bestPerm: number[] = [];

      // Execute Algorithm Step
      if (prev.algorithm === 'GA') {
        const res = runGeneticAlgorithmStep(
          instance, 
          populationRef.current, 
          params.gaMutationRate, 
          params.gaPopulationSize,
          params.gaElitismCount,
          params.gaTournamentSize
        );
        populationRef.current = res.newPopulation;
        bestMake = res.bestMake;
        bestPerm = res.bestInd;
      } 
      else if (prev.algorithm === 'SA') {
        const res = runSimulatedAnnealingStep(instance, currentPermRef.current, tempRef.current, params.saCoolingRate); 
        currentPermRef.current = res.nextPerm;
        tempRef.current = res.nextTemp;
        bestPerm = res.nextPerm; 
        bestMake = res.bestMake;
      }
      else if (prev.algorithm === 'HC') {
        const res = runHillClimbingStep(instance, currentPermRef.current);
        currentPermRef.current = res.nextPerm;
        bestPerm = res.nextPerm;
        bestMake = res.bestMake;
      }

      // Update State
      const newGen = prev.currentIteration + 1;
      const globalBest = Math.min(prev.bestMakespan, bestMake);
      
      let newSchedules = schedules;

      if (bestMake < prev.bestMakespan) {
        const fullRes = calculateSchedule(instance, bestPerm);
        fullRes.generation = newGen;
        // Add to history if it's an improvement
        setSchedules(curr => {
           const updated = [fullRes, ...curr].slice(0, 50); 
           newSchedules = updated; // Capture for comparison update
           return updated; 
        });
        setViewIndex(0);
      }

      // Update Comparison History Live
      if (bestMake < prev.bestMakespan) {
         // Only update history if we found a new global best for this run
         // But for boxplot we ideally want the FINAL best of the run.
         // Since this is a continuous loop, we can just track the best found so far.
         // However, to avoid cluttering the boxplot with intermediate steps of a SINGLE run,
         // we should probably only add to history when the user stops or it finishes.
         // But the current architecture makes that tricky without a refactor.
         // For now, let's keep the behavior of adding improvements, but maybe we can debounce it or only add significant ones?
         // Actually, the user asked to check logic. If we run several times, we want to see distribution.
         // If we add every intermediate step, we get a distribution of "steps" not "runs".
         // Let's change this: DO NOT update comparison history here.
         // We will update it only when the optimization loop finishes or is stopped.
      }

      requestRef.current = requestAnimationFrame(loopOptimization);

      return {
        ...prev,
        currentIteration: newGen,
        bestMakespan: globalBest,
        history: [...prev.history, { iteration: newGen, makespan: globalBest }]
      };
    });
  };

  const handleNext = () => setViewIndex(prev => Math.min(prev + 1, schedules.length - 1));
  const handlePrev = () => setViewIndex(prev => Math.max(prev - 1, 0));

  const currentSchedule = schedules[viewIndex];

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-950 text-slate-200 font-sans">
      
      {/* Sidebar */}
      <aside className="w-full md:w-96 bg-slate-900 border-r border-slate-800 flex flex-col p-6 gap-6 overflow-y-auto shrink-0 shadow-2xl z-10">
        <div>
          <h1 className="text-2xl font-bold text-blue-400 flex items-center gap-2">
            <Activity className="w-6 h-6" /> FlowShop.AI
          </h1>
          <p className="text-xs text-slate-500 mt-1 uppercase tracking-wider">Discrete Event Simulation</p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800">
          <button 
            onClick={() => setActiveTab('simulation')}
            className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider ${activeTab === 'simulation' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Simulation
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider ${activeTab === 'settings' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Settings
          </button>
        </div>

        {activeTab === 'simulation' ? (
          <>
            {/* Input */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Problem Instance</label>
                <div className="flex gap-3">
                  <button onClick={() => setInputText(DEFAULT_INSTANCE_TEXT)} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                    <RotateCcw className="w-3 h-3" /> Sample
                  </button>
                  <button onClick={resetApp} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /> Clear
                  </button>
                </div>
              </div>
              <textarea 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="w-full h-32 bg-slate-800 border border-slate-700 rounded p-3 text-[10px] font-mono text-slate-300 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
                placeholder="Paste instance data..."
              />
              {error && <div className="text-xs text-red-400 bg-red-900/20 p-2 rounded">{error}</div>}
            </div>

            {/* Controls */}
            <div className="space-y-4 pt-4 border-t border-slate-800">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Simulation Controls</label>
              
              <button 
                onClick={handleRunRandom}
                disabled={!instance || optState.isRunning}
                className="w-full py-2 px-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-sm font-medium"
              >
                <Play className="w-4 h-4 text-emerald-400" />
                <span>Generate 10 Random</span>
              </button>

              <div className="space-y-2">
                 <div className="flex gap-2 relative group">
                    <select 
                      value={optState.algorithm}
                      onChange={(e) => setOptState(p => ({...p, algorithm: e.target.value as AlgorithmType}))}
                      className="flex-1 bg-slate-800 border border-slate-700 text-sm rounded px-3 py-2 outline-none focus:border-blue-500"
                      disabled={optState.isRunning}
                    >
                      <option value="GA">Genetic Algorithm (GA)</option>
                      <option value="SA">Simulated Annealing (SA)</option>
                      <option value="HC">Stochastic Hill Climbing</option>
                      <option value="SimPy">SimPy Simulation</option>
                      <option value="Mesa">Mesa Simulation</option>
                      <option value="Salabim">Salabim Simulation</option>
                    </select>
                    <div className="p-2 text-slate-500 hover:text-blue-400 cursor-help">
                      <Info className="w-5 h-5" />
                      <div className="absolute left-0 bottom-full mb-2 w-64 p-3 bg-slate-800 border border-slate-700 rounded shadow-xl text-xs text-slate-300 hidden group-hover:block z-50 pointer-events-none">
                        {ALGO_INFO[optState.algorithm]}
                      </div>
                    </div>
                 </div>

                 <button 
                  onClick={optState.isRunning ? stopOptimization : startOptimization}
                  disabled={!instance}
                  className={`w-full py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-all font-medium text-sm shadow-lg ${
                    optState.isRunning 
                    ? 'bg-red-500/10 border border-red-500 text-red-400 hover:bg-red-500/20' 
                    : 'bg-blue-600 hover:bg-blue-500 border border-blue-500 text-white'
                  }`}
                >
                  {optState.isRunning ? (
                    <>Stop Process</>
                  ) : (
                    <>
                      <Zap className="w-4 h-4" /> Run Optimizer
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Convergence Plot */}
            <div className="pt-4 border-t border-slate-800 space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Live Convergence</label>
                <span className="text-[10px] text-slate-500">Iter: {optState.currentIteration}</span>
              </div>
              <OptimizationPlot data={optState.history} width={320} height={100} />
            </div>
          </>
        ) : (
          <div className="space-y-6">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-blue-400 flex items-center gap-2"><Settings className="w-4 h-4"/> Simulation Engine (Backend)</h3>
              <div className="p-2 bg-slate-800/50 rounded border border-slate-800 text-[10px] text-slate-400 mb-2">
                SimPy, Mesa, and Salabim use a <strong>Random Search</strong> strategy. They run multiple independent simulations with random job permutations to find the best schedule.
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Max Iterations (Simulations)</label>
                <input 
                  type="number" 
                  value={params.maxIterations}
                  onChange={(e) => setParams(p => ({...p, maxIterations: parseInt(e.target.value) || 100}))}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                />
                <p className="text-[10px] text-slate-500">Number of random schedules to evaluate.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Random Seed</label>
                <input 
                  type="number" 
                  value={params.randomSeed || 42}
                  onChange={(e) => setParams(p => ({...p, randomSeed: parseInt(e.target.value) || 42}))}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                />
                <p className="text-[10px] text-slate-500">Ensures reproducibility of results.</p>
              </div>
              <div className="p-2 bg-yellow-900/20 rounded border border-yellow-900/50 text-[10px] text-yellow-500 mt-2">
                 Note: These parameters apply to SimPy, Mesa, and Salabim models running on the backend.
              </div>
            </div>

            <div className="space-y-3 border-t border-slate-800 pt-4">
              <h3 className="text-sm font-semibold text-blue-400">Genetic Algorithm (GA)</h3>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Population Size</label>
                <input 
                  type="number" 
                  value={params.gaPopulationSize}
                  onChange={(e) => setParams(p => ({...p, gaPopulationSize: parseInt(e.target.value) || 20}))}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                />
                <p className="text-[10px] text-slate-500">Number of candidate solutions in each generation.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Mutation Rate (0-1)</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={params.gaMutationRate}
                  onChange={(e) => setParams(p => ({...p, gaMutationRate: parseFloat(e.target.value) || 0.2}))}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                />
                <p className="text-[10px] text-slate-500">Probability of random changes in offspring.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Tournament Size</label>
                <input 
                  type="number" 
                  value={params.gaTournamentSize || 3}
                  onChange={(e) => setParams(p => ({...p, gaTournamentSize: parseInt(e.target.value) || 3}))}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                />
                <p className="text-[10px] text-slate-500">Number of individuals selected for tournament.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Elitism Count</label>
                <input 
                  type="number" 
                  value={params.gaElitismCount || 2}
                  onChange={(e) => setParams(p => ({...p, gaElitismCount: parseInt(e.target.value) || 2}))}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                />
                <p className="text-[10px] text-slate-500">Number of top individuals preserved for next generation.</p>
              </div>
            </div>

            <div className="space-y-3 border-t border-slate-800 pt-4">
              <h3 className="text-sm font-semibold text-blue-400">Simulated Annealing (SA)</h3>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Initial Temperature</label>
                <input 
                  type="number" 
                  value={params.saInitialTemp}
                  onChange={(e) => setParams(p => ({...p, saInitialTemp: parseInt(e.target.value) || 1000}))}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                />
                <p className="text-[10px] text-slate-500">Starting temperature. Higher values allow more exploration.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Cooling Rate (0-1)</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={params.saCoolingRate}
                  onChange={(e) => setParams(p => ({...p, saCoolingRate: parseFloat(e.target.value) || 0.03}))}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                />
                <p className="text-[10px] text-slate-500">Rate at which temperature decreases. Lower is slower convergence.</p>
              </div>
            </div>
          </div>
        )}

      </aside>

      {/* Main View */}
      <main className="flex-1 p-6 overflow-y-auto flex flex-col bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 gap-6">
        
        {/* Top Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0">
          <StatBox label="Best Makespan" value={optState.bestMakespan === Infinity ? '-' : optState.bestMakespan} color="text-blue-400" />
          <StatBox label="Schedules Found" value={schedules.length} color="text-purple-400" />
          <StatBox label="Current Algo" value={optState.algorithm} color="text-emerald-400" />
          <StatBox label="Active Jobs" value={instance?.numJobs || '-'} color="text-slate-400" />
        </div>

        {/* Gantt Chart Container */}
        <div className="flex flex-col bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden shadow-2xl relative shrink-0">
          <div className="h-12 border-b border-slate-800 bg-slate-900 px-4 flex justify-between items-center shrink-0">
             <h2 className="text-sm font-semibold flex items-center gap-2">
               <BarChart3 className="w-4 h-4 text-slate-500" />
               Schedule Visualization
             </h2>
             
             {schedules.length > 0 && (
               <div className="flex items-center gap-4 bg-slate-950 px-2 py-1 rounded border border-slate-800">
                 <button onClick={handlePrev} disabled={viewIndex === 0} className="p-1 hover:text-blue-400 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                 <span className="text-xs font-mono w-24 text-center">
                   #{viewIndex + 1} <span className="text-slate-600">/ {schedules.length}</span>
                 </span>
                 <button onClick={handleNext} disabled={viewIndex === schedules.length - 1} className="p-1 hover:text-blue-400 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
               </div>
             )}
          </div>

          <div className="overflow-auto p-4 relative" style={{ minHeight: '300px', maxHeight: '600px' }}>
            {currentSchedule && instance ? (
               <div className="min-w-max">
                 <div className="mb-4 flex gap-4 text-xs text-slate-500 font-mono">
                    <span>Makespan: <strong className="text-slate-200">{currentSchedule.makespan}</strong></span>
                    {currentSchedule.generation && <span>Found at Iteration: <strong className="text-slate-200">{currentSchedule.generation}</strong></span>}
                 </div>
                 <GanttChart schedule={currentSchedule.schedule} instance={instance} makespan={currentSchedule.makespan} />
               </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600" style={{ minHeight: '150px' }}>
                <Activity className="w-12 h-12 mb-4 opacity-20" />
                <p>Run simulation to visualize schedules</p>
              </div>
            )}
          </div>
        </div>

        {/* Box Plot Container */}
        <div className="flex flex-col bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden shadow-xl shrink-0">
          <div className="h-10 border-b border-slate-800 bg-slate-900 px-4 flex items-center gap-2">
             <TrendingDown className="w-4 h-4 text-slate-500" />
             <h2 className="text-sm font-semibold">Algorithm Comparison (Top 10 Results)</h2>
          </div>
          <div className="p-6 flex justify-center">
             <BoxPlot data={comparisonHistory} width={800} height={250} />
          </div>
        </div>

      </main>
    </div>
  );
};

const StatBox = ({ label, value, color }: { label: string, value: string | number, color: string }) => (
  <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-lg">
    <div className="text-[10px] uppercase text-slate-500 tracking-wider font-semibold mb-1">{label}</div>
    <div className={`text-xl font-bold ${color}`}>{value}</div>
  </div>
);

export default App;