# Implementation Plan: Arch Folder Services Setup

**Date:** January 31, 2026  
**Goal:** Create basic service setup in Arch folder similar to existing Micro-service folder

---

## Current State Analysis

### ✅ What You Have (Micro-service folder):

| Component | Tech | Port | Status |
|-----------|------|------|--------|
| **PostgreSQL** | PostgreSQL 15 | 5432 | ✅ Running |
| **Kafka + Zookeeper** | Confluent | 9092, 2181 | ✅ Running |
| **Budget Service** | Spring Boot | 8001 | ✅ Running |
| **Request Service** | NestJS | 3001 | ✅ Running |
| **API Gateway** | NestJS | 3000 | ✅ Running |
| **Frontend** | React + Vite | 3100 | ✅ Running |

**Key Observations:**
- ✅ Simple docker-compose.dev.yml with 6 services
- ✅ PostgreSQL with init-db.sql for schema setup
- ✅ Kafka for event streaming
- ✅ Health checks configured
- ✅ Service-to-service communication working
- ✅ Hot reload for development (mounted volumes)

---

## Target State (Arch folder design):

According to [procurement-system-architecture.md](procurement-system-architecture.md), we need:

| Service | Tech | Port | Priority | Status |
|---------|------|------|----------|--------|
| **User Service** | NestJS | 3002 | 🔴 HIGH | ❌ Not created |
| **Budget Service** | Spring Boot | 8001 | 🔴 HIGH | ⚠️ Exists in Micro-service |
| **Requisition Service** | Spring Boot | 8002 | 🔴 HIGH | ⚠️ Similar to request-service |
| **Vendor Service** | NestJS | 3003 | 🟡 MEDIUM | ❌ Not created |
| **Order & Payment Service** | Spring Boot | 8003 | 🟡 MEDIUM | ❌ Not created |
| **Notification Worker** | NestJS | 3004 | 🟡 MEDIUM | ❌ Not created |

**Additional Infrastructure (from Arch):**
- Keycloak (8080) - Auth
- Vault (8200) - Secrets
- Redis (6379) - Caching
- MinIO (9000, 9001) - File storage
- Mailhog (1025, 8025) - Email testing
- Elasticsearch (9200) - Audit logs

---

## Implementation Strategy

### Phase 1: Foundation Setup (Week 1) 🔴 HIGH PRIORITY

**Goal:** Get basic infrastructure + 3 core services running

#### Step 1.1: Setup Arch Folder Structure
```
Arch/
├── docker-compose.dev.yml          # NEW - Development compose
├── init-databases.sql              # Already exists
├── services/                        # NEW - Service directory
│   ├── user-service/               # NEW - NestJS
│   ├── budget-service/             # COPY from Micro-service
│   ├── requisition-service/        # NEW - Spring Boot
│   ├── vendor-service/             # NEW - NestJS (later)
│   ├── order-payment-service/      # NEW - Spring Boot (later)
│   └── notification-worker/        # NEW - NestJS (later)
└── frontend/                        # COPY from Micro-service

```

#### Step 1.2: Create docker-compose.dev.yml in Arch
```yaml
# Similar structure to Micro-service/docker-compose.dev.yml
# But with all services from architecture design
services:
  - postgres (with separate databases per service)
  - redis (NEW)
  - kafka + zookeeper
  - keycloak (NEW)
  - user-service (NEW - port 3002)
  - budget-service (port 8001)
  - requisition-service (NEW - port 8002)
  - api-gateway (port 3000)
  - frontend (port 3100)
```

#### Step 1.3: Service Creation Priority

**PHASE 1A - Core Services (This Week):**

1. **User Service (NestJS)** - Port 3002
   - User CRUD
   - Department management
   - Basic auth (before Keycloak)
   - PostgreSQL: `user_service` database
   
2. **Budget Service (Spring Boot)** - Port 8001
   - Copy from Micro-service folder
   - Adapt database schema
   - Keep existing logic
   
3. **Requisition Service (Spring Boot)** - Port 8002
   - Similar to request-service but Spring Boot
   - Purchase request CRUD
   - Approval workflow
   - Integration with Budget Service

**PHASE 1B - Integration (Next Week):**

4. **API Gateway** - Port 3000
   - Copy from Micro-service
   - Add routes for User Service
   
5. **Frontend** - Port 3100
   - Copy from Micro-service
   - Add User Management UI
   - Add Department Management UI

---

## Detailed Implementation Steps

### STEP 1: Setup Arch Folder Structure (Day 1)

```bash
cd /Users/veroke/Documents/Free/Five/Arch

# Create services directory
mkdir -p services

# Copy budget-service from Micro-service
cp -r ../Micro-service/services/budget-service ./services/

# Create placeholder directories for other services
mkdir -p services/user-service
mkdir -p services/requisition-service
mkdir -p services/vendor-service
mkdir -p services/order-payment-service
mkdir -p services/notification-worker

# Copy frontend
cp -r ../Micro-service/frontend ./frontend

# Copy API Gateway (we'll adapt it)
cp -r ../Micro-service/services/api-gateway ./services/
```

---

### STEP 2: Create User Service (NestJS) (Day 1-2)

**Technology Stack:**
- NestJS 10.x
- TypeORM
- PostgreSQL
- Kafka (for events)

**Directory Structure:**
```
services/user-service/
├── Dockerfile.dev
├── package.json
├── nest-cli.json
├── tsconfig.json
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   │   └── database.config.ts
│   ├── controllers/
│   │   ├── user.controller.ts
│   │   └── department.controller.ts
│   ├── services/
│   │   ├── user.service.ts
│   │   └── department.service.ts
│   ├── entities/
│   │   ├── user.entity.ts
│   │   └── department.entity.ts
│   ├── dto/
│   │   ├── create-user.dto.ts
│   │   └── create-department.dto.ts
│   └── kafka/
│       └── kafka-producer.service.ts
```

**Core Endpoints:**
```typescript
// User Management
POST   /api/v1/users              - Create user
GET    /api/v1/users              - List users (paginated)
GET    /api/v1/users/:id          - Get user details
PUT    /api/v1/users/:id          - Update user
DELETE /api/v1/users/:id          - Delete user

// Department Management
POST   /api/v1/departments        - Create department
GET    /api/v1/departments        - List departments
GET    /api/v1/departments/:id    - Get department details
PUT    /api/v1/departments/:id    - Update department

// Health Check
GET    /api/v1/health             - Service health
```

---

### STEP 3: Create Requisition Service (Spring Boot) (Day 2-3)

**Technology Stack:**
- Spring Boot 3.2.1
- Spring Data JPA
- PostgreSQL
- Spring Kafka

**Directory Structure:**
```
services/requisition-service/
├── Dockerfile.dev
├── pom.xml
├── src/
│   └── main/
│       ├── java/
│       │   └── com/procurement/requisition/
│       │       ├── RequisitionServiceApplication.java
│       │       ├── controller/
│       │       │   ├── RequisitionController.java
│       │       │   └── ApprovalController.java
│       │       ├── service/
│       │       │   ├── RequisitionService.java
│       │       │   └── ApprovalService.java
│       │       ├── entity/
│       │       │   ├── PurchaseRequest.java
│       │       │   ├── RequestItem.java
│       │       │   └── ApprovalStep.java
│       │       ├── dto/
│       │       │   ├── CreateRequestDto.java
│       │       │   └── ApprovalDto.java
│       │       ├── repository/
│       │       │   └── RequisitionRepository.java
│       │       └── kafka/
│       │           └── EventProducer.java
│       └── resources/
│           └── application.yml
```

**Core Endpoints:**
```java
// Requisition Management
POST   /api/v1/requisitions           - Create purchase request
GET    /api/v1/requisitions           - List requests (paginated)
GET    /api/v1/requisitions/:id       - Get request details
PUT    /api/v1/requisitions/:id       - Update request
DELETE /api/v1/requisitions/:id       - Cancel request

// Approval Workflow
POST   /api/v1/requisitions/:id/approve  - Approve request
POST   /api/v1/requisitions/:id/reject   - Reject request
GET    /api/v1/requisitions/:id/approvals - Get approval history

// Health Check
GET    /api/v1/requisitions/health    - Service health
```

---

### STEP 4: Create docker-compose.dev.yml in Arch (Day 3)

**Key Differences from Micro-service:**
1. Separate databases per service (user_service, budget_service, requisition_service)
2. Add Redis for caching
3. Add Keycloak (optional for Phase 1)
4. Add MinIO (optional for Phase 1)
5. Port mapping to avoid conflicts

**Service Port Mapping:**
```yaml
PostgreSQL:       5432
Redis:            6379
Kafka:            9092, 29092
Zookeeper:        2181
Keycloak:         8080 (optional Phase 1)
MinIO API:        9000 (optional Phase 1)
MinIO Console:    9001 (optional Phase 1)
Mailhog SMTP:     1025 (optional Phase 1)
Mailhog Web:      8025 (optional Phase 1)

# Services
User Service:           3002
Budget Service:         8001
Requisition Service:    8002
API Gateway:            3000
Frontend:               3100
```

---

### STEP 5: Update init-databases.sql (Day 3)

Expand the existing init-databases.sql to create all service databases:

```sql
-- Create databases for each service
CREATE DATABASE user_service;
CREATE DATABASE budget_service;
CREATE DATABASE requisition_service;
CREATE DATABASE vendor_service;
CREATE DATABASE order_payment_service;

-- Create keycloak database (if using Keycloak in Phase 1)
CREATE DATABASE keycloak;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE user_service TO procurement;
GRANT ALL PRIVILEGES ON DATABASE budget_service TO procurement;
GRANT ALL PRIVILEGES ON DATABASE requisition_service TO procurement;
GRANT ALL PRIVILEGES ON DATABASE vendor_service TO procurement;
GRANT ALL PRIVILEGES ON DATABASE order_payment_service TO procurement;
GRANT ALL PRIVILEGES ON DATABASE keycloak TO procurement;
```

---

### STEP 6: Update API Gateway (Day 4)

Add new routes for User Service and Requisition Service:

```typescript
// src/app.module.ts - Add new controllers

@Module({
  imports: [
    ConfigModule.forRoot(),
    HttpModule,
  ],
  controllers: [
    HealthController,
    BudgetController,      // Existing
    RequestController,     // Existing (rename to RequisitionController)
    UserController,        // NEW
    DepartmentController,  // NEW
  ],
  providers: [
    KafkaService,
  ],
})
export class AppModule {}
```

---

### STEP 7: Test Integration (Day 4-5)

**Testing Workflow:**
```bash
# Start all services
cd Arch
docker-compose -f docker-compose.dev.yml up -d

# Wait for services to be healthy
docker-compose -f docker-compose.dev.yml ps

# Test User Service
curl http://localhost:3002/api/v1/health
curl -X POST http://localhost:3002/api/v1/departments \
  -H "Content-Type: application/json" \
  -d '{"name": "IT Department", "code": "IT"}'

# Test Budget Service
curl http://localhost:8001/api/v1/budgets/health

# Test Requisition Service
curl http://localhost:8002/api/v1/requisitions/health

# Test API Gateway (integration)
curl http://localhost:3000/api/v1/health
curl http://localhost:3000/api/v1/users
curl http://localhost:3000/api/v1/budgets
curl http://localhost:3000/api/v1/requisitions

# Test Frontend
open http://localhost:3100
```

---

## Phase 2: Additional Services (Week 2-3) 🟡 MEDIUM PRIORITY

After Phase 1 is stable, add:

### STEP 8: Vendor Service (NestJS) - Port 3003
- Vendor CRUD
- RFQ management
- Quotation handling
- Vendor portal API

### STEP 9: Order & Payment Service (Spring Boot) - Port 8003
- Purchase order creation
- Goods receipt
- Invoice matching
- Payment processing

### STEP 10: Notification Worker (NestJS) - Port 3004
- Kafka consumer
- Email sending
- Template rendering

---

## Phase 3: Infrastructure Enhancement (Week 4) 🟢 LOW PRIORITY

### STEP 11: Add Keycloak
- Authentication
- User federation
- JWT tokens

### STEP 12: Add MinIO
- File storage
- Presigned URLs
- Bucket management

### STEP 13: Add Mailhog
- Email testing
- SMTP server

### STEP 14: Add Elasticsearch
- Audit logs
- Full-text search

---

## Key Decisions to Make

### Decision 1: Service Migration Strategy

**Option A: Copy & Adapt (Recommended for Phase 1)**
- Copy budget-service from Micro-service
- Adapt database connection
- Keep existing logic
- ✅ **Pro:** Fast, proven code
- ❌ **Con:** May need refactoring later

**Option B: Start Fresh**
- Build from scratch following Arch specs
- Clean architecture
- ✅ **Pro:** Follows design exactly
- ❌ **Con:** Takes longer

**Recommendation:** Use Option A for Phase 1, refactor in Phase 2

---

### Decision 2: Database Strategy

**Option A: Shared Database (Current Micro-service approach)**
```yaml
postgres:
  POSTGRES_DB: procurement_mvp
  # All services use same database
```

**Option B: Separate Databases (Arch design - Recommended)**
```yaml
postgres:
  # Create multiple databases in init script
  # user_service, budget_service, requisition_service, etc.
```

**Recommendation:** Use Option B (separate databases) from the start
- Follows microservice best practices
- Easier to scale later
- Better data isolation

---

### Decision 3: Development Workflow

**Current (Micro-service):**
```bash
docker-compose -f docker-compose.dev.yml up -d
# Edit code → Auto-reload (nodemon/Spring DevTools)
```

**Proposed (Arch):**
```bash
cd Arch
docker-compose -f docker-compose.dev.yml up -d
# Edit code → Auto-reload
# Same workflow, more services
```

**Recommendation:** Keep same workflow, just add more services

---

## File Structure Comparison

### Current (Micro-service):
```
Micro-service/
├── docker-compose.dev.yml
├── init-db.sql
├── frontend/
└── services/
    ├── api-gateway/
    ├── budget-service/
    └── request-service/
```

### Target (Arch):
```
Arch/
├── docker-compose.dev.yml         # Enhanced version
├── init-databases.sql             # Multiple databases
├── frontend/                      # Copied from Micro-service
└── services/                      # 6+ services
    ├── user-service/              # NEW
    ├── budget-service/            # Copied & adapted
    ├── requisition-service/       # NEW
    ├── vendor-service/            # NEW (Phase 2)
    ├── order-payment-service/     # NEW (Phase 2)
    ├── notification-worker/       # NEW (Phase 2)
    └── api-gateway/               # Copied & enhanced
```

---

## Development Checklist

### Week 1: Foundation
- [ ] Create Arch/services/ directory structure
- [ ] Create User Service (NestJS)
  - [ ] Setup project structure
  - [ ] User entity & CRUD
  - [ ] Department entity & CRUD
  - [ ] Kafka integration
  - [ ] Health check endpoint
- [ ] Copy & adapt Budget Service
  - [ ] Update database connection
  - [ ] Test endpoints
- [ ] Create Requisition Service (Spring Boot)
  - [ ] Setup project structure
  - [ ] Requisition entity & CRUD
  - [ ] Approval workflow
  - [ ] Budget service integration
- [ ] Create docker-compose.dev.yml
  - [ ] PostgreSQL with multiple databases
  - [ ] Redis
  - [ ] Kafka + Zookeeper
  - [ ] All 3 services
- [ ] Update init-databases.sql
- [ ] Test service-to-service communication
- [ ] Copy & adapt API Gateway
- [ ] Copy & adapt Frontend

### Week 2: Enhancement
- [ ] Add Vendor Service
- [ ] Add Order & Payment Service
- [ ] Add Notification Worker
- [ ] Integration testing

### Week 3: Infrastructure
- [ ] Add Keycloak
- [ ] Add MinIO
- [ ] Add Mailhog
- [ ] Add monitoring

---

## Success Criteria

**Phase 1 Complete When:**
- ✅ All 3 services running in docker-compose
- ✅ PostgreSQL with 3 separate databases
- ✅ Kafka event streaming working
- ✅ API Gateway routing to all services
- ✅ Frontend can interact with all services
- ✅ Health checks passing
- ✅ Basic CRUD operations working
- ✅ Hot reload working for development

---

## Next Steps

1. **Review this plan** - Make sure it aligns with your needs
2. **Start with Step 1** - Setup folder structure
3. **Create User Service** - First new service
4. **Daily standup** - Track progress and blockers

---

**Questions to Answer Before Starting:**

1. Should we copy budget-service from Micro-service or create new one?
2. Should we start with all infrastructure (Keycloak, MinIO, etc.) or minimal first?
3. Do you want to keep request-service (NestJS) or switch to requisition-service (Spring Boot)?
4. Should API Gateway be in Arch folder or shared between projects?
5. Port assignments - any conflicts with other projects?

---

**Estimated Timeline:**

| Phase | Duration | Services |
|-------|----------|----------|
| Phase 1A | 3-4 days | User Service, Budget Service, Requisition Service |
| Phase 1B | 2-3 days | API Gateway, Frontend integration |
| Phase 2 | 1-2 weeks | Vendor, Order, Notification services |
| Phase 3 | 1 week | Infrastructure (Keycloak, MinIO, etc.) |

**Total: 3-4 weeks for complete implementation**

---

Let me know which approach you prefer and we can start implementing! 🚀
