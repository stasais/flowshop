from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Any
import simpy
import random
import salabim as sim
import mesa

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
    randomSeed: int = 42

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
    
    # Use the seed
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

# Serve static files (Frontend)
app.mount("/", StaticFiles(directory="/app/static", html=True), name="static")
