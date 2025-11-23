#!/bin/bash

# Attempt to get GEMINI_API_KEY from environment or .env file
if [ -z "$GEMINI_API_KEY" ] && [ -f .env ]; then
  # Simple grep to find the key. 
  # Note: This assumes the format GEMINI_API_KEY=value without quotes or comments on the same line for simplicity.
  export GEMINI_API_KEY=$(grep GEMINI_API_KEY .env | cut -d '=' -f2 | tr -d '"' | tr -d "'")
fi

echo "Stopping any existing container..."
docker stop flowshop-container 2>/dev/null || true
docker rm flowshop-container 2>/dev/null || true

echo "Starting FlowShop HEO3 with Docker Compose..."
docker compose up --build -d

echo "------------------------------------------------"
echo "App is running at http://localhost:3030"
echo "------------------------------------------------"
