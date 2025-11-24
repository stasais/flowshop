export interface Job {
  id: number;
  processingTimes: number[]; // Index is stage
}

export interface Instance {
  numJobs: number;
  numStages: number;
  machinesPerStage: number[];
  jobs: Job[];
  // Optional parameters for backend optimization
  maxIterations?: number;
  randomSeed?: number;
}

export interface TaskLog {
  jobId: number;
  stageId: number;
  machineId: number; // Relative to stage
  globalMachineId: number; // Unique ID for visualization
  startTime: number;
  endTime: number;
}

export interface ScheduleResult {
  makespan: number;
  schedule: TaskLog[];
  permutation: number[];
  generation?: number;
}

export type AlgorithmType = 'GA' | 'SA' | 'HC' | 'SimPy' | 'Mesa' | 'Salabim' | 'Skopt' | 'DEAP' | 'Optuna' | 'LPT' | 'SPT' | 'Random' | 'Bottleneck' | 'FirstSPT' | 'LastSPT';

export interface AlgorithmParams {
  // GA
  gaPopulationSize: number;
  gaMutationRate: number;
  gaTournamentSize: number;
  gaElitismCount: number;
  
  // SA
  saInitialTemp: number;
  saCoolingRate: number;
  
  // HC
  // (none specific yet)
  
  // General
  maxIterations: number;
  randomSeed: number | null;
}

export interface OptimizationState {
  bestMakespan: number;
  currentIteration: number;
  maxIterations: number; // Kept for backward compat or convenience, but should sync with params
  isRunning: boolean;
  history: { iteration: number; makespan: number }[];
  algorithm: AlgorithmType;
}