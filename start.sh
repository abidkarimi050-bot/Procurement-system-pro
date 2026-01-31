#!/bin/bash

# Procurement System - Arch Folder Services
# Quick Start Script

set -e

echo "🚀 Starting Procurement System (Arch Implementation)..."
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker Desktop first.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker is running${NC}"
echo ""

# Stop any existing containers
echo -e "${YELLOW}🧹 Cleaning up existing containers...${NC}"
docker compose -f docker-compose.dev.yml down 2>/dev/null || true
echo ""

# Pull latest images
echo -e "${YELLOW}📦 Pulling Docker images...${NC}"
docker compose -f docker-compose.dev.yml pull
echo ""

# Build and start services
echo -e "${YELLOW}🔨 Building and starting services...${NC}"
docker compose -f docker-compose.dev.yml up -d --build
echo ""

# Wait for services to be healthy
echo -e "${YELLOW}⏳ Waiting for services to be healthy...${NC}"
echo ""

sleep 5

# Check service health
echo "Checking service status..."
docker compose -f docker-compose.dev.yml ps

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}   🎉 Services Started Successfully!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "📍 Service URLs:"
echo ""
echo "  Infrastructure:"
echo "  • PostgreSQL:          localhost:5433"
echo "  • Redis:               localhost:6379"
echo "  • Kafka:               localhost:9092"
echo ""
echo "  Microservices:"
echo "  • User Service:        http://localhost:3002/api/v1/health"
echo "  • Budget Service:      http://localhost:8001/api/v1/budgets/health"
echo "  • API Gateway:         http://localhost:3000/api/v1/health"
echo ""
echo "  Application:"
echo "  • Frontend:            http://localhost:3100"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "📝 Useful Commands:"
echo ""
echo "  View logs (all):       docker compose -f docker-compose.dev.yml logs -f"
echo "  View logs (specific):  docker compose -f docker-compose.dev.yml logs -f user-service"
echo "  Stop services:         docker compose -f docker-compose.dev.yml stop"
echo "  Restart services:      docker compose -f docker-compose.dev.yml restart"
echo "  Remove all:            docker compose -f docker-compose.dev.yml down -v"
echo ""
echo "🧪 Test Commands:"
echo ""
echo "  # Test User Service"
echo "  curl http://localhost:3002/api/v1/health"
echo ""
echo "  # Create a department"
echo "  curl -X POST http://localhost:3000/api/v1/departments \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"name\":\"IT Department\",\"code\":\"IT\",\"created_by\":\"00000000-0000-0000-0000-000000000000\"}'"
echo ""
echo "  # Create a user"
echo "  curl -X POST http://localhost:3000/api/v1/users \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"email\":\"john@example.com\",\"first_name\":\"John\",\"last_name\":\"Doe\"}'"
echo ""
echo "═══════════════════════════════════════════════════════════"
