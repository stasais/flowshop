import { GoogleGenAI } from "@google/genai";
import { ScheduleResult, Instance } from "../types";

// Function to get AI Analysis
export const analyzeScheduleWithGemini = async (
  instance: Instance,
  result: ScheduleResult,
  avgRandomMakespan: number
): Promise<string> => {
  
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found in environment variables.");
  }

  const ai = new GoogleGenAI({ apiKey });

  const utilization = calculateUtilization(instance, result);
  
  const prompt = `
    You are an expert in Operations Research and Production Scheduling.
    Analyze the following Hybrid Flow Shop Scheduling result.

    **Problem Instance:**
    - Jobs: ${instance.numJobs}
    - Stages: ${instance.numStages}
    - Machines Configuration: ${instance.machinesPerStage.join(', ')}

    **Simulation Results:**
    - Achieved Makespan: ${result.makespan}
    - Average Random Makespan: ${avgRandomMakespan}
    - Improvement over Random: ${((avgRandomMakespan - result.makespan) / avgRandomMakespan * 100).toFixed(2)}%
    - Estimated Machine Utilization: ${utilization.toFixed(2)}%

    **Task:**
    1. Comment on the quality of the solution compared to the random baseline.
    2. Identify potential bottlenecks based on the problem structure (e.g., which stage has fewer machines or higher processing times?).
    3. Suggest general heuristic strategies that could further improve flow shop problems of this specific structure (Hybrid Flow Shop).
    
    Keep the response concise, professional, and actionable. Use Markdown.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text || "No analysis generated.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw new Error("Failed to generate analysis. Please check your API key and connection.");
  }
};

const calculateUtilization = (instance: Instance, result: ScheduleResult): number => {
  let totalProcTime = 0;
  instance.jobs.forEach(j => {
    j.processingTimes.forEach(t => totalProcTime += t);
  });

  let totalMachineCapacity = 0;
  instance.machinesPerStage.forEach(m => {
    totalMachineCapacity += m * result.makespan;
  });

  return (totalProcTime / totalMachineCapacity) * 100;
};
