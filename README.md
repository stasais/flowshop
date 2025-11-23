# FlowShop HEO3

A comprehensive Flow Shop scheduling application that combines interactive frontend optimization algorithms with robust backend discrete event simulations.

## Quick Start

To start the application immediately:

```bash
docker compose up --build
```

Then open [http://localhost:3030](http://localhost:3030).

## Features

- **Interactive Visualization**:
  - **Gantt Chart**: Visualize the schedule of jobs across machines.
  - **Optimization Plot**: Real-time convergence tracking of optimization algorithms.
  - **Box Plot**: Compare the performance distribution of different algorithms.

- **Optimization Algorithms (Frontend)**:
  - Genetic Algorithm (GA)
  - Simulated Annealing (SA)
  - Stochastic Hill Climbing (HC)

- **Simulation Engines (Backend)**:
  - **SimPy**: Discrete Event Simulation.
  - **Mesa**: Agent-Based Modeling.
  - **Salabim**: Discrete Event Simulation.
  - *Note: Backend engines use a Random Search strategy for optimization.*

- **Configuration**:
  - Adjustable parameters for all algorithms (Population size, Mutation rate, Temperature, Iterations, Random Seed, etc.).

## Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS, Lucide React.
- **Backend**: Python 3.11, FastAPI, Uvicorn.
- **Simulation Libraries**: SimPy, Mesa, Salabim.
- **Infrastructure**: Docker (Multi-stage build).

## Getting Started

### Prerequisites

- Docker Desktop installed and running.

### Running with Docker (Recommended)

You can use the provided helper script which wraps `docker compose`:

```bash
./start_docker.sh
```

Or run `docker compose` directly:

```bash
docker compose up --build -d
```

This will start the application on port 3030.

Access the app at: [http://localhost:3030](http://localhost:3030)

### Manual Setup

#### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

#### Frontend

```bash
npm install
npm run dev
```

## Usage

1. **Input Data**: Paste your Flow Shop instance data in the text area (or use the default sample).
2. **Select Algorithm**: Choose between frontend algorithms (GA, SA, HC) or backend simulations (SimPy, Mesa, Salabim).
3. **Configure**: Go to the "Settings" tab to tune parameters like iterations, population size, or random seed.
4. **Run**: Click "Run Optimizer" to start the simulation.
5. **Analyze**: View the resulting schedule on the Gantt chart and compare performance statistics.
