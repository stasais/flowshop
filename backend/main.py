from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import simpy
import random
import salabim as sim
import mesa
import optuna
from skopt import gp_minimize
from skopt.space import Real
from deap import base, creator, tools
import statistics

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Data Models ---

class Job(BaseModel):
    id: int
    processingTimes: List[float]

class Instance(BaseModel):
    numJobs: int
    numStages: int
    machinesPerStage: List[int]
    jobs: List[Job]
    # Optional parameters for optimization
    maxIterations: int = 100
    randomSeed: Optional[int] = 42
    
    # GA Parameters (DEAP)
    gaPopulationSize: int = 20
    gaMutationRate: float = 0.2
    gaTournamentSize: int = 3
    gaElitismCount: int = 2

class TaskLog(BaseModel):
    jobId: int
    stageId: int
    machineId: int
    globalMachineId: int
    startTime: float
    endTime: float

class ScheduleResult(BaseModel):
    makespan: float
    schedule: List[TaskLog]
    permutation: List[int]

# --- SimPy Implementation ---

def run_simpy_simulation(instance: Instance, permutation: List[int]) -> ScheduleResult:
    env = simpy.Environment()
    
    # Create resources for each stage
    machines = [simpy.Resource(env, capacity=c) for c in instance.machinesPerStage]
    
    schedule_log: List[TaskLog] = []

    def job_process(env, job_id, processing_times):
        for stage_idx, proc_time in enumerate(processing_times):
            machine = machines[stage_idx]
            
            # Request machine
            with machine.request() as req:
                yield req
                
                # We got the machine
                start_time = env.now
                yield env.timeout(proc_time)
                end_time = env.now
                
                # Calculate global machine ID for viz
                global_offset = sum(instance.machinesPerStage[:stage_idx])
                machine_id = 0 # Simplified for viz
                
                schedule_log.append(TaskLog(
                    jobId=job_id,
                    stageId=stage_idx,
                    machineId=machine_id, 
                    globalMachineId=global_offset + machine_id,
                    startTime=start_time,
                    endTime=end_time
                ))

    # Start processes in permutation order
    for job_id in permutation:
        job = next(j for j in instance.jobs if j.id == job_id)
        env.process(job_process(env, job.id, job.processingTimes))

    env.run()
    
    makespan = env.now
    return ScheduleResult(makespan=makespan, schedule=schedule_log, permutation=permutation)

def optimize_with_random_search(instance: Instance, simulation_func) -> ScheduleResult:
    best_result = None
    best_makespan = float('inf')
    
    # Use the seed if provided
    if instance.randomSeed is not None:
        random.seed(instance.randomSeed)
    
    # Run maxIterations times
    for _ in range(instance.maxIterations):
        # Generate random permutation
        perm = list(range(instance.numJobs))
        random.shuffle(perm)
        
        try:
            result = simulation_func(instance, perm)
            if result.makespan < best_makespan:
                best_makespan = result.makespan
                best_result = result
        except Exception as e:
            print(f"Simulation error: {e}")
            continue
            
    if best_result is None:
        # Fallback to simple 0..N order if all failed
        perm = list(range(instance.numJobs))
        return simulation_func(instance, perm)
        
    return best_result


# --- Heuristics & Advanced Optimization ---

def get_makespan(instance: Instance, perm: List[int]) -> float:
    res = run_simpy_simulation(instance, perm)
    return res.makespan

def heuristic_spt(instance: Instance) -> ScheduleResult:
    sorted_jobs = sorted(instance.jobs, key=lambda j: sum(j.processingTimes))
    perm = [j.id for j in sorted_jobs]
    return run_simpy_simulation(instance, perm)

def heuristic_lpt(instance: Instance) -> ScheduleResult:
    sorted_jobs = sorted(instance.jobs, key=lambda j: sum(j.processingTimes), reverse=True)
    perm = [j.id for j in sorted_jobs]
    return run_simpy_simulation(instance, perm)

def heuristic_first_stage_spt(instance: Instance) -> ScheduleResult:
    sorted_jobs = sorted(instance.jobs, key=lambda j: j.processingTimes[0])
    perm = [j.id for j in sorted_jobs]
    return run_simpy_simulation(instance, perm)

def heuristic_last_stage_spt(instance: Instance) -> ScheduleResult:
    sorted_jobs = sorted(instance.jobs, key=lambda j: j.processingTimes[-1])
    perm = [j.id for j in sorted_jobs]
    return run_simpy_simulation(instance, perm)

def heuristic_bottleneck(instance: Instance) -> ScheduleResult:
    min_machines = min(instance.machinesPerStage)
    bottleneck_stage_idx = instance.machinesPerStage.index(min_machines)
    sorted_jobs = sorted(instance.jobs, key=lambda j: j.processingTimes[bottleneck_stage_idx])
    perm = [j.id for j in sorted_jobs]
    return run_simpy_simulation(instance, perm)

def optimize_optuna(instance: Instance) -> ScheduleResult:
    # Notebook default: 50 trials
    n_trials = instance.maxIterations if instance.maxIterations is not None else 50
    
    def objective(trial):
        x = [trial.suggest_float(f'x_{j.id}', 0.0, 1.0) for j in instance.jobs]
        job_scores = []
        for i, job in enumerate(instance.jobs):
            job_scores.append((job.id, x[i]))
        job_scores.sort(key=lambda item: item[1])
        perm = [item[0] for item in job_scores]
        return get_makespan(instance, perm)

    study = optuna.create_study(direction='minimize')
    study.optimize(objective, n_trials=n_trials)
    
    best_x = [study.best_params[f'x_{j.id}'] for j in instance.jobs]
    job_scores = []
    for i, job in enumerate(instance.jobs):
        job_scores.append((job.id, best_x[i]))
    job_scores.sort(key=lambda item: item[1])
    best_perm = [item[0] for item in job_scores]
    
    return run_simpy_simulation(instance, best_perm)

def optimize_skopt(instance: Instance) -> ScheduleResult:
    # Notebook default: 50 calls
    n_calls = instance.maxIterations if instance.maxIterations is not None else 50
    
    def objective(x):
        job_scores = []
        for i, job in enumerate(instance.jobs):
            job_scores.append((job.id, x[i]))
        job_scores.sort(key=lambda item: item[1])
        perm = [item[0] for item in job_scores]
        return get_makespan(instance, perm)

    space = [Real(0.0, 1.0) for _ in range(instance.numJobs)]
    
    # Notebook uses random_state=0
    random_state = instance.randomSeed if instance.randomSeed is not None else 0
    
    res = gp_minimize(objective, space, n_calls=n_calls, random_state=random_state)
    
    best_x = res.x
    job_scores = []
    for i, job in enumerate(instance.jobs):
        job_scores.append((job.id, best_x[i]))
    job_scores.sort(key=lambda item: item[1])
    best_perm = [item[0] for item in job_scores]
    
    return run_simpy_simulation(instance, best_perm)

def optimize_deap(instance: Instance) -> ScheduleResult:
    # Notebook defaults
    GA_POP_SIZE = instance.gaPopulationSize
    GA_MUT_RATE = instance.gaMutationRate
    GA_TOURN_SIZE = instance.gaTournamentSize
    GA_ELITISM = instance.gaElitismCount
    # Notebook default: 600 generations
    GA_N_GEN = instance.maxIterations if instance.maxIterations is not None else 600
    GA_CROSSOVER_RATE = 0.9
    GA_MUT_INDPB = 0.05
    
    if instance.randomSeed is not None:
        random.seed(instance.randomSeed)

    if not hasattr(creator, 'FitnessMin'):
        creator.create('FitnessMin', base.Fitness, weights=(-1.0,))
    if not hasattr(creator, 'Individual'):
        creator.create('Individual', list, fitness=creator.FitnessMin)

    toolbox = base.Toolbox()
    job_ids = [j.id for j in instance.jobs]
    toolbox.register('individual', tools.initIterate, creator.Individual, lambda: random.sample(job_ids, len(job_ids)))
    toolbox.register('population', tools.initRepeat, list, toolbox.individual)
    
    def evaluate(ind):
        return (get_makespan(instance, ind),)
        
    toolbox.register('evaluate', evaluate)
    toolbox.register('mate', tools.cxOrdered)
    toolbox.register('mutate', tools.mutShuffleIndexes, indpb=GA_MUT_INDPB)
    toolbox.register('select', tools.selTournament, tournsize=GA_TOURN_SIZE)

    pop = toolbox.population(n=GA_POP_SIZE)
    
    for ind in pop:
        ind.fitness.values = toolbox.evaluate(ind)
        
    for gen in range(GA_N_GEN):
        elites = tools.selBest(pop, GA_ELITISM)
        offspring = toolbox.select(pop, len(pop)-GA_ELITISM)
        offspring = list(map(toolbox.clone, offspring))
        
        for i in range(1, len(offspring), 2):
            if random.random() < GA_CROSSOVER_RATE:
                toolbox.mate(offspring[i-1], offspring[i])
                del offspring[i-1].fitness.values
                del offspring[i].fitness.values
                
        for mutant in offspring:
            if random.random() < GA_MUT_RATE:
                toolbox.mutate(mutant)
                del mutant.fitness.values
                
        invalid = [ind for ind in offspring if not ind.fitness.valid]
        for ind in invalid:
            ind.fitness.values = toolbox.evaluate(ind)
            
        pop = elites + offspring
        
    best = tools.selBest(pop, 1)[0]
    return run_simpy_simulation(instance, list(best))


# --- Mesa Implementation ---

class JobAgent(mesa.Agent):
    def __init__(self, unique_id, model, job_data):
        super().__init__(model)
        self.unique_id = unique_id
        self.job_data = job_data
        self.current_stage = 0
        self.remaining_time = 0
        self.status = "waiting" # waiting, processing, done
        self.machine_assigned = -1

class FlowShopModel(mesa.Model):
    def __init__(self, instance: Instance, permutation: List[int]):
        super().__init__()
        self.instance = instance
        self.agents_list = []
        self.machines_busy_until = [[0] * c for c in instance.machinesPerStage]
        self.task_log = []
        self.current_time = 0
        self.running = True
        
        # Create Agents
        for i, job_id in enumerate(permutation):
            job_data = next(j for j in instance.jobs if j.id == job_id)
            a = JobAgent(i, self, job_data)
            self.agents_list.append(a)

    def step(self):
        # This is a simplified tick-based simulation.
        # In each step (tick=1 unit), we check if agents can start processing.
        
        # We iterate agents in the order added (permutation order) to give priority
        for agent in self.agents_list:
            if agent.status == "done":
                continue
                
            if agent.status == "processing":
                agent.remaining_time -= 1
                if agent.remaining_time <= 0:
                    # Finished stage
                    agent.current_stage += 1
                    agent.status = "waiting"
                    agent.machine_assigned = -1
                    if agent.current_stage >= self.instance.numStages:
                        agent.status = "done"
            
            if agent.status == "waiting":
                # Try to find a machine in current stage
                stage = agent.current_stage
                if stage >= self.instance.numStages:
                    agent.status = "done"
                    continue
                    
                proc_time = agent.job_data.processingTimes[stage]
                
                # Find free machine
                best_machine = -1
                for m_idx in range(self.instance.machinesPerStage[stage]):
                    if self.machines_busy_until[stage][m_idx] <= self.current_time:
                        best_machine = m_idx
                        break
                
                if best_machine != -1:
                    # Start processing
                    agent.status = "processing"
                    agent.remaining_time = proc_time
                    agent.machine_assigned = best_machine
                    
                    # Reserve machine
                    self.machines_busy_until[stage][best_machine] = self.current_time + proc_time
                    
                    # Log
                    global_offset = sum(self.instance.machinesPerStage[:stage])
                    self.task_log.append(TaskLog(
                        jobId=agent.job_data.id,
                        stageId=stage,
                        machineId=best_machine,
                        globalMachineId=global_offset + best_machine,
                        startTime=self.current_time,
                        endTime=self.current_time + proc_time
                    ))

        self.current_time += 1

def run_mesa_simulation(instance: Instance, permutation: List[int]) -> ScheduleResult:
    model = FlowShopModel(instance, permutation)
    
    # Run until all agents done
    steps = 0
    while any(a.status != "done" for a in model.agents_list):
        model.step()
        steps += 1
        if steps > 100000: # Safety break
            break
            
    return ScheduleResult(makespan=model.current_time, schedule=model.task_log, permutation=permutation)


# --- Salabim Implementation ---

def run_salabim_simulation(instance: Instance, permutation: List[int]) -> ScheduleResult:
    sim.yieldless(False) # Required for generator-based processes in newer Salabim
    env = sim.Environment(trace=False)
    
    # Resources
    machines = []
    for s, count in enumerate(instance.machinesPerStage):
        # Salabim Resource
        machines.append(sim.Resource(name=f'Stage_{s}', capacity=count, env=env))
        
    schedule_log = []
    
    class JobComponent(sim.Component):
        def setup(self, job_id, processing_times):
            self.job_id = job_id
            self.processing_times = processing_times
            
        def process(self):
            for s, duration in enumerate(self.processing_times):
                # Request machine
                yield self.request(machines[s])
                
                start_time = env.now()
                yield self.hold(duration)
                end_time = env.now()
                
                # Log
                global_offset = sum(instance.machinesPerStage[:s])
                schedule_log.append(TaskLog(
                    jobId=self.job_id,
                    stageId=s,
                    machineId=0,
                    globalMachineId=global_offset,
                    startTime=start_time,
                    endTime=end_time
                ))
                
                self.release(machines[s])

    # Create components in order
    for i, job_id in enumerate(permutation):
        job_data = next(j for j in instance.jobs if j.id == job_id)
        JobComponent(job_id=job_id, processing_times=job_data.processingTimes, env=env)
        
    env.run()
    
    return ScheduleResult(makespan=env.now(), schedule=schedule_log, permutation=permutation)


# --- API Endpoints ---

@app.post("/api/optimize/simpy", response_model=ScheduleResult)
async def optimize_simpy(instance: Instance):
    try:
        return optimize_with_random_search(instance, run_simpy_simulation)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/optimize/mesa", response_model=ScheduleResult)
async def optimize_mesa(instance: Instance):
    try:
        return optimize_with_random_search(instance, run_mesa_simulation)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/optimize/salabim", response_model=ScheduleResult)
async def optimize_salabim(instance: Instance):
    try:
        return optimize_with_random_search(instance, run_salabim_simulation)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/optimize/optuna", response_model=ScheduleResult)
async def endpoint_optuna(instance: Instance):
    try:
        return optimize_optuna(instance)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/optimize/skopt", response_model=ScheduleResult)
async def endpoint_skopt(instance: Instance):
    try:
        return optimize_skopt(instance)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/optimize/deap", response_model=ScheduleResult)
async def endpoint_deap(instance: Instance):
    try:
        return optimize_deap(instance)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/optimize/lpt", response_model=ScheduleResult)
async def endpoint_lpt(instance: Instance):
    try:
        return heuristic_lpt(instance)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/optimize/spt", response_model=ScheduleResult)
async def endpoint_spt(instance: Instance):
    try:
        return heuristic_spt(instance)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/optimize/firstspt", response_model=ScheduleResult)
async def endpoint_firstspt(instance: Instance):
    try:
        return heuristic_first_stage_spt(instance)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/optimize/lastspt", response_model=ScheduleResult)
async def endpoint_lastspt(instance: Instance):
    try:
        return heuristic_last_stage_spt(instance)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/optimize/bottleneck", response_model=ScheduleResult)
async def endpoint_bottleneck(instance: Instance):
    try:
        return heuristic_bottleneck(instance)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/optimize/random", response_model=ScheduleResult)
async def endpoint_random(instance: Instance):
    try:
        return optimize_with_random_search(instance, run_simpy_simulation)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Serve static files (Frontend)
app.mount("/", StaticFiles(directory="/app/static", html=True), name="static")
