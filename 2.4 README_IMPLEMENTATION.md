# Procurement System - Arch Implementation

**Production-ready microservice architecture** based on the comprehensive design specifications.

---

## 🏗️ Architecture Overview

This implementation follows the **6-microservice architecture** defined in [procurement-system-architecture.md](procurement-system-architecture.md):

### Phase 1 Services (Currently Implemented):

| Service | Technology | Port | Status | Database |
|---------|-----------|------|--------|----------|
| **User Service** | NestJS + TypeORM | 3002 | ✅ Ready | user_service |
| **Budget Service** | Spring Boot + JPA | 8001 | ✅ Ready | budget_service |
| **API Gateway** | NestJS | 3000 | ✅ Ready | - |
| **Frontend** | React + Vite | 3100 | ✅ Ready | - |

### Infrastructure:

| Component | Port | Status | Purpose |
|-----------|------|--------|---------|
| PostgreSQL | 5432 | ✅ | Separate database per service |
| Redis | 6379 | ✅ | Caching & sessions |
| Kafka + Zookeeper | 9092, 2181 | ✅ | Event streaming |

---

## 🚀 Quick Start

### Prerequisites

- Docker Desktop installed and running
- 8GB RAM available
- Ports 3000, 3002, 3100, 5432, 6379, 8001, 9092 available

### Start All Services

```bash
cd Arch
./start.sh
```

Or manually:

```bash
docker-compose -f docker-compose.dev.yml up -d --build
```

### Verify Services

```bash
# Check all containers
docker-compose -f docker-compose.dev.yml ps

# View logs
docker-compose -f docker-compose.dev.yml logs -f

# Health checks
curl http://localhost:3002/api/v1/health  # User Service
curl http://localhost:8001/api/v1/budgets/health  # Budget Service
curl http://localhost:3000/api/v1/health  # API Gateway
```

---

## 📁 Project Structure

```
Arch/
├── docker-compose.dev.yml          # Development orchestration
├── init-databases.sql              # Database initialization
├── start.sh                        # Quick start script
├── services/
│   ├── user-service/              # ✅ User & Department management (NestJS)
│   ├── budget-service/            # ✅ Budget operations (Spring Boot)
│   ├── api-gateway/               # ✅ API Gateway (NestJS)
│   ├── requisition-service/       # 🔜 Coming in Phase 2
│   ├── vendor-service/            # 🔜 Coming in Phase 2
│   ├── order-payment-service/     # 🔜 Coming in Phase 2
│   └── notification-worker/       # 🔜 Coming in Phase 2
├── frontend/                      # ✅ React frontend
└── docs/                          # Architecture documentation
```

---

## 🔌 API Endpoints

### User Service (via API Gateway)

```bash
# Users
POST   /api/v1/users                # Create user
GET    /api/v1/users                # List users (paginated)
GET    /api/v1/users/:id            # Get user details
PUT    /api/v1/users/:id            # Update user
DELETE /api/v1/users/:id            # Deactivate user

# Departments
POST   /api/v1/departments          # Create department
GET    /api/v1/departments          # List departments
GET    /api/v1/departments/:id      # Get department details
PUT    /api/v1/departments/:id      # Update department
```

### Budget Service (via API Gateway)

```bash
GET    /api/v1/budgets/health       # Health check
# (Additional budget endpoints from existing service)
```

---

## 🧪 Testing

### Create a Department

```bash
curl -X POST http://localhost:3000/api/v1/departments \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "IT Department",
    "code": "IT",
    "description": "Information Technology Department",
    "created_by": "00000000-0000-0000-0000-000000000000"
  }'
```

### Create a User

```bash
curl -X POST http://localhost:3000/api/v1/users \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "john.doe@company.com",
    "first_name": "John",
    "last_name": "Doe",
    "job_title": "Software Engineer",
    "phone": "+1234567890"
  }'
```

### List Users (Paginated)

```bash
curl 'http://localhost:3000/api/v1/users?page=1&limit=10'
```

### Search Users

```bash
curl 'http://localhost:3000/api/v1/users?search=john'
```

---

## 🗄️ Database Structure

Each service has its own PostgreSQL database:

```sql
-- Created automatically via init-databases.sql
user_service              -- User & Department tables
budget_service            -- Budget, Allocations, Transactions
requisition_service       -- (Phase 2)
vendor_service            -- (Phase 2)
order_payment_service     -- (Phase 2)
```

### Access PostgreSQL

```bash
docker exec -it arch-postgres psql -U procurement -d user_service

# List tables
\dt

# Query users
SELECT * FROM users;

# Query departments
SELECT * FROM departments;
```

---

## 📊 Monitoring

### View Logs

```bash
# All services
docker-compose -f docker-compose.dev.yml logs -f

# Specific service
docker-compose -f docker-compose.dev.yml logs -f user-service
docker-compose -f docker-compose.dev.yml logs -f budget-service

# Last 100 lines
docker-compose -f docker-compose.dev.yml logs --tail=100
```

### Check Service Status

```bash
docker-compose -f docker-compose.dev.yml ps
```

### Resource Usage

```bash
docker stats
```

---

## 🛠️ Development Workflow

### Hot Reload Enabled

All services support hot reload during development:

- **NestJS services**: Changes to `src/` automatically reload
- **Spring Boot**: DevTools enabled for auto-restart
- **React**: Vite HMR for instant updates

### Making Changes

1. Edit code in `services/*/src/`
2. Save file
3. Service automatically restarts
4. Test changes immediately

### Adding a New Endpoint

**User Service Example:**

1. Create DTO in `services/user-service/src/dto/`
2. Add method to service in `services/user-service/src/services/`
3. Add controller endpoint in `services/user-service/src/controllers/`
4. Add proxy in API Gateway: `services/api-gateway/src/user/user.controller.ts`
5. Test via `http://localhost:3000/api/v1/your-endpoint`

---

## 🔧 Common Commands

```bash
# Start services
docker-compose -f docker-compose.dev.yml up -d

# Stop services (preserve data)
docker-compose -f docker-compose.dev.yml stop

# Restart a specific service
docker-compose -f docker-compose.dev.yml restart user-service

# Rebuild and restart
docker-compose -f docker-compose.dev.yml up -d --build user-service

# View container details
docker inspect arch-user-service

# Execute command in container
docker exec -it arch-user-service sh

# Clean everything (including volumes)
docker-compose -f docker-compose.dev.yml down -v
```

---

## 🐛 Troubleshooting

### Service Won't Start

```bash
# Check logs
docker-compose -f docker-compose.dev.yml logs user-service

# Rebuild container
docker-compose -f docker-compose.dev.yml up -d --build user-service
```

### Database Connection Issues

```bash
# Check PostgreSQL is running
docker-compose -f docker-compose.dev.yml ps postgres

# Check database exists
docker exec -it arch-postgres psql -U procurement -l

# Recreate databases
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up -d
```

### Port Already in Use

```bash
# Find process using port 3002
lsof -i :3002

# Kill process (replace PID)
kill -9 <PID>
```

### Kafka Connection Issues

```bash
# Check Kafka is healthy
docker-compose -f docker-compose.dev.yml logs kafka

# Restart Kafka
docker-compose -f docker-compose.dev.yml restart kafka zookeeper
```

---

## 📦 Service Details

### User Service (NestJS)

**Responsibilities:**
- User CRUD operations
- Department management
- Organization hierarchy
- Event publishing to Kafka

**Tech Stack:**
- NestJS 10.x
- TypeORM
- PostgreSQL
- KafkaJS

**Database:** `user_service`

**Events Published:**
- `user.created`
- `user.updated`
- `user.deleted`
- `department.created`
- `department.updated`

### Budget Service (Spring Boot)

**Responsibilities:**
- Budget management
- Budget allocation
- Budget reservations
- Balance tracking

**Tech Stack:**
- Spring Boot 3.2.1
- Spring Data JPA
- PostgreSQL
- Spring Kafka

**Database:** `budget_service`

---

## 🚦 Roadmap

### ✅ Phase 1 (Completed)
- User Service
- Budget Service
- API Gateway
- Frontend
- Docker Compose setup
- Separate databases per service

### 🔜 Phase 2 (Next)
- Requisition Service (Spring Boot)
- Vendor Service (NestJS)
- Order & Payment Service (Spring Boot)
- Notification Worker (NestJS)

### 🔮 Phase 3 (Future)
- Keycloak integration
- MinIO file storage
- Elasticsearch audit logs
- Mailhog email testing
- Grafana dashboards

---

## 📚 Documentation

- [Architecture Design](procurement-system-architecture.md)
- [Database Design](DATABASE_DESIGN.md)
- [Developer Quickstart](DEVELOPER_QUICKSTART.md)
- [Docker Setup Guide](DOCKER_SETUP.md)
- [Best Practices](BEST_PRACTICES.md)
- [Implementation Plan](IMPLEMENTATION_PLAN.md)

---

## 🤝 Contributing

1. Follow coding standards in [BEST_PRACTICES.md](BEST_PRACTICES.md)
2. Use proper TypeScript/Java types
3. Add health checks to all services
4. Publish events for important actions
5. Write integration tests

---

## 📄 License

Proprietary - Internal Use Only

---

## 🆘 Support

For issues or questions:
1. Check logs: `docker-compose -f docker-compose.dev.yml logs -f`
2. Review [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)
3. Check health endpoints
4. Restart services if needed

---

**Last Updated:** January 31, 2026  
**Version:** 1.0.0 (Phase 1 Complete)
