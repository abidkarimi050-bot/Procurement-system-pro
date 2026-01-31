# Developer Quick Start - Standards & Best Practices

This document summarizes the critical standards all developers must follow before writing code.

---

## 📋 Critical Checklist Before You Code

### 1. ✅ Understand Pagination & Filtering
Every list endpoint (`GET /api/v1/resources`) must support:
```
page=1&limit=20&sort=created_at:desc&search=keyword&filter[status]=active
```

Response format (same for ALL services):
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8,
    "hasNext": true,
    "hasPrev": false
  },
  "meta": {
    "timestamp": "2024-01-22T10:30:00Z",
    "version": "v1"
  }
}
```

**Reference**: See [BEST_PRACTICES.md](BEST_PRACTICES.md) section "1. Pagination, Filtering & Search"

---

### 2. ✅ Global Exception Handling
**NestJS**: Use `HttpExceptionFilter` + custom exceptions  
**Spring Boot**: Use `GlobalExceptionHandler` with `@RestControllerAdvice`

Standard error response:
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "timestamp": "2024-01-22T10:30:00Z",
  "path": "/api/v1/requisitions",
  "errors": {
    "amount": "must be greater than 0"
  }
}
```

**Reference**: See [BEST_PRACTICES.md](BEST_PRACTICES.md) section "2/3. NestJS/Spring Boot Exception Filters"

---

### 3. ✅ Proper Type Definitions
Every entity and DTO must have proper typing:

**NestJS (TypeScript)**:
```typescript
export interface IPurchaseRequest extends BaseEntity {
  title: string;
  amount: number;
  status: RequestStatus;
}
```

**Spring Boot (Java)**:
```java
@Entity
@Table(name = "purchase_requests")
public class PurchaseRequest {
  @Column(nullable = false)
  private String title;
  
  @Column(precision = 15, scale = 2)
  private BigDecimal amount;
  
  @Enumerated(EnumType.STRING)
  private RequestStatus status;
}
```

**Reference**: See [TYPING_GUIDE.md](TYPING_GUIDE.md) - Complete typing examples for all services

---

### 4. ✅ Environment Configuration (.env files)
Every service needs a `.env` file with proper configuration:

**For NestJS Services (User, Vendor)**:
```env
NODE_ENV=development
DATABASE_URL=postgresql://procurement:procurement123@localhost:5432/user_service
JWT_SECRET=your-super-secret-key-change-in-production
KEYCLOAK_URL=http://localhost:8080
KAFKA_BROKER=localhost:29092
REDIS_URL=redis://localhost:6379
MAIL_HOST=localhost
MAIL_PORT=1025
```

**For Spring Boot Services (Budget, Requisition, Order & Payment)**:
```properties
# application.yml or application.properties
spring.datasource.url=jdbc:postgresql://localhost:5432/budget_service
spring.datasource.username=procurement
spring.datasource.password=procurement123
spring.security.oauth2.resourceserver.jwt.issuer-uri=http://localhost:8080/realms/procurement
spring.kafka.bootstrap-servers=localhost:29092
```

**Reference**: See [DOCKER_SETUP.md](DOCKER_SETUP.md) for complete configuration

---

### 5. ✅ Database Schema Awareness
Know your service's database schema BEFORE coding:

| Service | Key Tables |
|---------|-----------|
| **User Service** | users, departments, roles, user_roles, approval_hierarchy |
| **Budget Service** | budgets, budget_reservations, budget_transactions |
| **Requisition Service** | purchase_requests, request_items, approval_records |
| **Vendor Service** | vendors, rfq_requests, quotations, quotation_line_items |
| **Order & Payment** | purchase_orders, invoices, payments, three_way_match |

**Reference**: See [DATABASE_DESIGN.md](DATABASE_DESIGN.md) for complete schemas

---

### 6. ✅ Event Publishing (Kafka)
When data changes, publish events for other services to consume:

**Event Naming**: `<service>.<entity>.<action>`

Examples:
- `user.user.created`
- `budget.reservation.created`
- `requisition.request.approved`
- `vendor.quotation.submitted`
- `order.payment.processed`

**NestJS Example**:
```typescript
await this.kafkaProducer.publishEvent('user.user.created', {
  eventId: uuid(),
  eventType: 'user.user.created',
  timestamp: new Date(),
  source: 'user-service',
  data: { userId: user.id, email: user.email }
});
```

**Spring Boot Example**:
```java
eventProducer.publishEvent("budget.reservation.created", 
    Map.of("reservationId", reservation.getId(), "amount", amount));
```

**Reference**: See [BEST_PRACTICES.md](BEST_PRACTICES.md) section "4. Event-Driven Communication"

---

### 7. ✅ Authentication & Authorization
All services use **Keycloak** for JWT validation:

**Roles**:
- `REQUESTER` - Can create purchase requests
- `MANAGER` - Can approve level-1 requests
- `FINANCE` - Can approve level-2 requests, manage budgets
- `ADMIN` - Full access

**Protect endpoints**:

**NestJS**:
```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('FINANCE', 'ADMIN')
@Get('budgets')
async findAll() { ... }
```

**Spring Boot**:
```java
.requestMatchers("/api/v1/budgets/**").hasAnyRole("FINANCE", "ADMIN")
```

**Reference**: See [BEST_PRACTICES.md](BEST_PRACTICES.md) section "5. Authentication & Authorization"

---

## 🚀 Quick Setup Steps

### 1. Start Infrastructure
```bash
cd /path/to/project
docker-compose -f docker-compose.infra.yml up -d

# Wait ~60 seconds for all services to start
docker-compose -f docker-compose.infra.yml ps
```

**Services Started**:
- PostgreSQL (localhost:5432)
- Redis (localhost:6379)
- Kafka + Zookeeper (localhost:29092)
- Keycloak (localhost:8080)
- Vault (localhost:8200)
- Mailhog (localhost:8025)
- Elasticsearch (localhost:9200)

---

### 2. Create Service Databases

```bash
# Connect to PostgreSQL
psql -h localhost -U procurement -d procurement

# Create service databases
CREATE DATABASE user_service;
CREATE DATABASE budget_service;
CREATE DATABASE requisition_service;
CREATE DATABASE vendor_service;
CREATE DATABASE order_payment_service;
CREATE DATABASE keycloak;
```

**Or use init script**:
```bash
psql -h localhost -U procurement -d procurement < init-databases.sql
```

---

### 3. Set Up NestJS Service (User or Vendor)

```bash
# Create service directory
mkdir -p services/user-service
cd services/user-service

# Initialize NestJS project
npx @nestjs/cli new . --skip-git

# Install dependencies
npm install @nestjs/typeorm typeorm pg @nestjs/passport passport passport-jwt
npm install @nestjs/config class-validator class-transformer
npm install kafkajs ioredis

# Create .env file
cat > .env << EOF
NODE_ENV=development
DATABASE_URL=postgresql://procurement:procurement123@localhost:5432/user_service
JWT_SECRET=your-secret-key
KEYCLOAK_URL=http://localhost:8080
KAFKA_BROKER=localhost:29092
EOF

# Generate modules
nest g module users
nest g controller users
nest g service users
nest g module auth
nest g service kafka
```

---

### 4. Set Up Spring Boot Service (Budget, Requisition, or Order & Payment)

```bash
# Generate using Spring Initializr
curl https://start.spring.io/starter.zip \
  -d type=maven-project \
  -d language=java \
  -d bootVersion=3.2.0 \
  -d baseDir=budget-service \
  -d groupId=com.procurement \
  -d artifactId=budget-service \
  -d name=budget-service \
  -d packageName=com.procurement.budget \
  -d javaVersion=17 \
  -d dependencies=web,data-jpa,postgresql,security,oauth2-resource-server,actuator,kafka,validation \
  -o budget-service.zip

unzip budget-service.zip -d services/

# Create application.yml
cat > services/budget-service/src/main/resources/application.yml << EOF
spring:
  application:
    name: budget-service
  datasource:
    url: jdbc:postgresql://localhost:5432/budget_service
    username: procurement
    password: procurement123
  jpa:
    hibernate:
      ddl-auto: none
    show-sql: true
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: http://localhost:8080/realms/procurement
  kafka:
    bootstrap-servers: localhost:29092
EOF
```

---

### 5. Run Database Migrations

**NestJS (TypeORM)**:
```bash
npm run typeorm migration:run
```

**Spring Boot (Flyway)**:
```bash
# Migrations run automatically on startup
./mvnw spring-boot:run
```

---

### 6. Run Service

**NestJS**:
```bash
npm run start:dev
```

**Spring Boot**:
```bash
./mvnw spring-boot:run
```

---

## 📖 Service-Specific Guidelines

### User Service (NestJS)
- **Port**: 3001
- **Database**: user_service
- **Key Features**: User CRUD, Department management, Role assignments
- **Events Published**: `user.user.created`, `user.department.created`

### Budget Service (Spring Boot)
- **Port**: 8081
- **Database**: budget_service
- **Key Features**: Budget allocation, Reservations, Top-up requests
- **Events Published**: `budget.reservation.created`, `budget.topup.approved`

### Requisition Service (Spring Boot)
- **Port**: 8082
- **Database**: requisition_service
- **Key Features**: Purchase requests, Approval workflows
- **Events Published**: `requisition.request.created`, `requisition.request.approved`

### Vendor Service (NestJS)
- **Port**: 3002
- **Database**: vendor_service
- **Key Features**: Vendor management, RFQ, Quotations
- **Events Published**: `vendor.quotation.submitted`, `vendor.vendor.created`

### Order & Payment Service (Spring Boot)
- **Port**: 8083
- **Database**: order_payment_service
- **Key Features**: Purchase orders, Invoices, Payments, 3-way matching
- **Events Published**: `order.order.created`, `order.payment.processed`

---

## 🧪 Testing Guidelines

### Unit Tests
```bash
# NestJS
npm run test

# Spring Boot
./mvnw test
```

### Integration Tests
```bash
# Use Testcontainers for real database
# NestJS
npm run test:e2e

# Spring Boot
./mvnw verify
```

### API Testing
```bash
# Using curl
curl http://localhost:3001/api/v1/users

# Using httpie
http GET localhost:8081/api/v1/budgets Authorization:"Bearer $TOKEN"
```

---

## 🔍 Common Pitfalls to Avoid

❌ **Don't** query other services' databases directly  
✅ **Do** use events or API calls

❌ **Don't** use magic strings for enums  
✅ **Do** use proper TypeScript/Java enums

❌ **Don't** forget pagination on list endpoints  
✅ **Do** always return paginated responses

❌ **Don't** skip validation on DTOs  
✅ **Do** use `class-validator` (NestJS) or `@Valid` (Spring Boot)

❌ **Don't** expose stack traces in production  
✅ **Do** use proper error responses

❌ **Don't** commit secrets or `.env` files  
✅ **Do** use `.env.example` as template

---

## 📚 Essential Reading Order

1. [BEST_PRACTICES.md](BEST_PRACTICES.md) - Global standards
2. [DATABASE_DESIGN.md](DATABASE_DESIGN.md) - Schema reference
3. [TYPING_GUIDE.md](TYPING_GUIDE.md) - Type definitions
4. [SORTING_EXAMPLES.md](SORTING_EXAMPLES.md) - Sorting implementation
5. [DOCKER_SETUP.md](DOCKER_SETUP.md) - Infrastructure setup

---

## 🆘 Getting Help

1. Check existing documentation in this folder
2. Review [procurement-system-architecture.md](procurement-system-architecture.md) for high-level design
3. Look at [architecture-qa-and-explanations.md](architecture-qa-and-explanations.md) for FAQs
4. Examine [GETTING-STARTED.md](GETTING-STARTED.md) for detailed setup

---

## ✅ Pre-Commit Checklist

Before pushing code, verify:

- [ ] Code follows pagination/filtering standards
- [ ] DTOs have proper validation decorators
- [ ] Exception handling is implemented
- [ ] Events are published for state changes
- [ ] Database migrations are created (if schema changed)
- [ ] Unit tests written and passing
- [ ] `.env` file not committed
- [ ] No hardcoded secrets
- [ ] API endpoints are protected with proper roles
- [ ] Code is formatted (`prettier` for NestJS, `mvn fmt` for Spring Boot)

---

**Ready to code?** Start with reading the architecture docs, then dive into [BEST_PRACTICES.md](BEST_PRACTICES.md)!
