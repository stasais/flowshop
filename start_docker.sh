#!/bin/bash

# Attempt to get GEMINI_API_KEY from environment or .env file
if [ -z "$GEMINI_API_KEY" ] && [ -f .env ]; then
  # Simple grep to find the key. 
  # Note: This assumes the format GEMINI_API_KEY=value without quotes or comments on the same line for simplicity.
  GEMINI_API_KEY=$(grep GEMINI_API_KEY .env | cut -d '=' -f2 | tr -d '"' | tr -d "'")
fi

echo "Building Docker image..."
# Pass the API key as a build argument
docker build -t flowshop-app --build-arg GEMINI_API_KEY="$GEMINI_API_KEY" .

echo "Stopping old container..."
docker stop flowshop-container 2>/dev/null || true
docker rm flowshop-container 2>/dev/null || true

echo "Starting new container on port 3030..."
docker run -d -p 3030:80 --name flowshop-container flowshop-app

echo "------------------------------------------------"
echo "App is running at http://localhost:3030"
echo "------------------------------------------------"
