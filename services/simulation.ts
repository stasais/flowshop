import { Instance, Job, ScheduleResult, TaskLog } from '../types';

// --- PARSING ---

export const parseInstanceData = (text: string): Instance => {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  // Line 1: Jobs Stages
  const [numJobs, numStages] = lines[0].trim().split(/\s+/).map(Number);
  
  // Line 2: Machines per stage
  const machinesPerStage = lines[1].trim().split(/\s+/).map(Number);
  
  if (machinesPerStage.length !== numStages) {
    throw new Error(`Mismatch: Defined ${numStages} stages but found configuration for ${machinesPerStage.length} stages.`);
  }

  const jobs: Job[] = Array.from({ length: numJobs }, (_, i) => ({
    id: i,
    processingTimes: []
  }));

  // Lines 3+: Processing times. 
  // Based on prompt example: "Time of the jobs in Stage 1" -> Row = Stage, Col = Job
  for (let s = 0; s < numStages; s++) {
    const times = lines[2 + s].trim().split(/\s+/).map(Number);
    if (times.length !== numJobs) {
       throw new Error(`Mismatch: Stage ${s + 1} has ${times.length} times, expected ${numJobs}.`);
    }
    for (let j = 0; j < numJobs; j++) {
      jobs[j].processingTimes[s] = times[j];
    }
  }

  return { numJobs, numStages, machinesPerStage, jobs };
};

export const generateRandomPermutation = (length: number): number[] => {
  const arr = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// --- SIMULATION ENGINE (Discrete Event Simulation - Salabim style logic) ---

export const calculateSchedule = (instance: Instance, jobPermutation: number[]): ScheduleResult => {
  const { numStages, machinesPerStage, jobs } = instance;
  
  // State tracking: machineAvailability[stage][machineIndex] = time when free
  const machineAvailability: number[][] = machinesPerStage.map(count => Array(count).fill(0));
  
  // jobAvailability[jobIndex] = time when job is free from previous stage
  const jobAvailability: number[] = Array(instance.numJobs).fill(0);
  
  const scheduleLog: TaskLog[] = [];

  // Flow Shop Logic:
  // Stage 0: Permutation order.
  // Stage k: FIFO based on arrival from k-1.
  let currentStageJobOrder = [...jobPermutation];

  for (let s = 0; s < numStages; s++) {
    const nextStageJobOrder: { id: number; availableAt: number }[] = [];

    for (const jobId of currentStageJobOrder) {
      const job = jobs[jobId];
      const procTime = job.processingTimes[s];
      const arrivalTime = jobAvailability[jobId];

      // FAM (First Available Machine) Rule
      let bestMachineIdx = -1;
      let bestMachineAvail = Infinity;
      
      for (let m = 0; m < machinesPerStage[s]; m++) {
        if (machineAvailability[s][m] < bestMachineAvail) {
          bestMachineAvail = machineAvailability[s][m];
          bestMachineIdx = m;
        }
      }

      // Calculate timings
      const startTime = Math.max(arrivalTime, bestMachineAvail);
      const endTime = startTime + procTime;

      // Update state
      machineAvailability[s][bestMachineIdx] = endTime;
      jobAvailability[jobId] = endTime;

      // Calculate a unique global machine ID for visualization
      let globalOffset = 0;
      for(let prevS=0; prevS<s; prevS++) globalOffset += machinesPerStage[prevS];
      
      scheduleLog.push({
        jobId,
        stageId: s,
        machineId: bestMachineIdx,
        globalMachineId: globalOffset + bestMachineIdx,
        startTime,
        endTime
      });

      nextStageJobOrder.push({ id: jobId, availableAt: endTime });
    }

    // Sort for next stage: FIFO based on completion time of current stage
    nextStageJobOrder.sort((a, b) => a.availableAt - b.availableAt);
    currentStageJobOrder = nextStageJobOrder.map(item => item.id);
  }

  const makespan = Math.max(...jobAvailability);
  
  return {
    makespan,
    schedule: scheduleLog,
    permutation: jobPermutation
  };
};


// --- MUTATION HELPERS ---

const mutateSwap = (perm: number[]) => {
  const clone = [...perm];
  const i = Math.floor(Math.random() * clone.length);
  const j = Math.floor(Math.random() * clone.length);
  [clone[i], clone[j]] = [clone[j], clone[i]];
  return clone;
};

// --- ALGORITHMS ---

// 1. Genetic Algorithm
export const runGeneticAlgorithmStep = (
  instance: Instance, 
  population: number[][], 
  mutationRate: number = 0.2,
  populationSize: number = 20,
  elitismCount: number = 2,
  tournamentSize: number = 3
): { newPopulation: number[][], bestInd: number[], bestMake: number } => {
  
  // Evaluate
  const evaluated = population.map(p => ({ p, makespan: calculateSchedule(instance, p).makespan }));
  evaluated.sort((a, b) => a.makespan - b.makespan);

  const bestInd = evaluated[0].p;
  const bestMake = evaluated[0].makespan;

  // Selection (Elitism)
  const newPop: number[][] = [];
  // Ensure elitism count doesn't exceed population size
  const safeElitismCount = Math.min(elitismCount, populationSize);
  for (let i = 0; i < safeElitismCount; i++) {
    if (i < evaluated.length) {
      newPop.push([...evaluated[i].p]);
    }
  }

  // Breeding
  while (newPop.length < populationSize) {
    const p1 = tournamentSelect(evaluated, tournamentSize).p;
    const p2 = tournamentSelect(evaluated, tournamentSize).p;
    const child = orderCrossover(p1, p2);
    
    if (Math.random() < mutationRate) {
      const i = Math.floor(Math.random() * child.length);
      const j = Math.floor(Math.random() * child.length);
      [child[i], child[j]] = [child[j], child[i]];
    }
    newPop.push(child);
  }

  return { newPopulation: newPop, bestInd, bestMake };
};

// 2. Simulated Annealing
export const runSimulatedAnnealingStep = (
  instance: Instance,
  currentPerm: number[],
  currentTemp: number,
  coolingRate: number
): { nextPerm: number[], bestPerm: number[], bestMake: number, nextTemp: number } => {
  
  const currentRes = calculateSchedule(instance, currentPerm);
  
  // Create neighbor
  const neighbor = mutateSwap(currentPerm);
  const neighborRes = calculateSchedule(instance, neighbor);

  // Acceptance Probability
  let accepted = false;
  if (neighborRes.makespan < currentRes.makespan) {
    accepted = true;
  } else {
    const delta = neighborRes.makespan - currentRes.makespan;
    const prob = Math.exp(-delta / currentTemp);
    if (Math.random() < prob) accepted = true;
  }

  const nextPerm = accepted ? neighbor : currentPerm;
  const actualNextRes = accepted ? neighborRes : currentRes;

  return {
    nextPerm,
    bestPerm: nextPerm, // In SA step, we just return current pointer, global best tracked in App
    bestMake: actualNextRes.makespan,
    nextTemp: currentTemp * (1 - coolingRate)
  };
};

// 3. Stochastic Hill Climbing
export const runHillClimbingStep = (
  instance: Instance,
  currentPerm: number[]
): { nextPerm: number[], bestMake: number } => {
  
  const currentRes = calculateSchedule(instance, currentPerm);
  const neighbor = mutateSwap(currentPerm);
  const neighborRes = calculateSchedule(instance, neighbor);

  if (neighborRes.makespan <= currentRes.makespan) {
    return { nextPerm: neighbor, bestMake: neighborRes.makespan };
  } else {
    return { nextPerm: currentPerm, bestMake: currentRes.makespan };
  }
};


// --- GA Helpers ---
const tournamentSelect = (pop: {p: number[], makespan: number}[], k: number = 3) => {
  let best = pop[Math.floor(Math.random() * pop.length)];
  for (let i = 0; i < k - 1; i++) {
    const candidate = pop[Math.floor(Math.random() * pop.length)];
    if (candidate.makespan < best.makespan) {
      best = candidate;
    }
  }
  return best;
};

const orderCrossover = (parent1: number[], parent2: number[]) => {
  const size = parent1.length;
  const child = Array(size).fill(-1);
  const start = Math.floor(Math.random() * size);
  const end = Math.floor(Math.random() * (size - start)) + start;
  const subset = new Set<number>();
  for (let i = start; i <= end; i++) {
    child[i] = parent1[i];
    subset.add(parent1[i]);
  }
  let p2Index = 0;
  for (let i = 0; i < size; i++) {
    if (i >= start && i <= end) continue;
    while (subset.has(parent2[p2Index])) p2Index++;
    child[i] = parent2[p2Index];
    p2Index++;
  }
  return child;
};