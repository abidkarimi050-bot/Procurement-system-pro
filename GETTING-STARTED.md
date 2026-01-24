# ═══════════════════════════════════════════════════════════════════════════
# Getting Started Guide - Procurement System
# ═══════════════════════════════════════════════════════════════════════════

## Quick Start (5 minutes)

### Prerequisites
- Docker & Docker Compose
- Java 17+ (for Spring Boot services)
- Node.js 18+ (for NestJS services)
- Git

### 1. Start Infrastructure

```bash
# Clone the infrastructure
cd /path/to/project

# Start all infrastructure services
docker-compose -f docker-compose.infra.yml up -d

# Wait for services to be healthy (about 60 seconds)
docker-compose -f docker-compose.infra.yml ps
```

### 2. Access Services

| Service | URL | Credentials |
|---------|-----|-------------|
| **Keycloak Admin** | http://localhost:8080 | admin / admin |
| **Vault UI** | http://localhost:8200 | Token: `root` |
| **Kafka UI** | http://localhost:9000 | - |
| **Mailhog** | http://localhost:8025 | - |
| **PostgreSQL** | localhost:5432 | procurement / procurement123 |
| **Redis** | localhost:6379 | - |
| **Elasticsearch** | http://localhost:9200 | - |

### 3. Keycloak Test Users

| User | Password | Role |
|------|----------|------|
| admin | admin123 | ADMIN, FINANCE |
| finance.user | finance123 | FINANCE |
| manager.user | manager123 | MANAGER |
| requester.user | requester123 | REQUESTER |

---

## Project Structure

```
procurement-system/
├── services/                          # Microservices (5 total)
│   ├── user-service/                  # NestJS - Users, Depts, Roles
│   ├── budget-service/                # Spring Boot - Budgets
│   ├── requisition-service/           # Spring Boot - Requests + Approvals
│   ├── vendor-service/                # NestJS - Vendors, Quotations
│   └── order-payment-service/         # Spring Boot - Orders, Invoices, Payments
│
├── infrastructure/                    # Kubernetes manifests
│   ├── base/
│   └── overlays/                      # dev / staging / prod
│
├── docker-compose.infra.yml           # Local infrastructure
├── init-databases.sql                 # Database initialization
└── keycloak/
    └── realm-export.json              # Keycloak realm config
```

---

## Creating a New Spring Boot Service

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
```

### Required application.yml

```yaml
spring:
  application:
    name: budget-service
  
  datasource:
    url: jdbc:postgresql://localhost:5432/budget_service
    username: procurement
    password: procurement123
  
  jpa:
    hibernate:
      ddl-auto: update
    show-sql: true
  
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: http://localhost:8080/realms/procurement
  
  kafka:
    bootstrap-servers: localhost:29092
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer

server:
  port: 8081
```

---

## Creating a New NestJS Service

```bash
# Install NestJS CLI
npm install -g @nestjs/cli

# Create new project
nest new vendor-service --package-manager npm

cd services/vendor-service

# Install required packages
npm install @nestjs/config @nestjs/typeorm typeorm pg
npm install @nestjs/passport passport passport-jwt @nestjs/jwt
npm install @nestjs/microservices kafkajs
npm install class-validator class-transformer
npm install @nestjs/swagger swagger-ui-express
```

### Required configuration

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  
  const config = new DocumentBuilder()
    .setTitle('Vendor Service')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);
  
  await app.listen(3001);
}
bootstrap();
```

---

## Running Services Locally

### Terminal 1: Infrastructure
```bash
docker-compose -f docker-compose.infra.yml up -d
```

### Terminal 2: Spring Boot Service
```bash
cd services/budget-service
./mvnw spring-boot:run -Dspring.profiles.active=local
```

### Terminal 3: NestJS Service
```bash
cd services/vendor-service
npm run start:dev
```

---

## Testing the Setup

### Get JWT Token
```bash
# Get token from Keycloak
TOKEN=$(curl -s -X POST \
  "http://localhost:8080/realms/procurement/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=procurement-frontend" \
  -d "username=requester.user" \
  -d "password=requester123" \
  -d "grant_type=password" | jq -r '.access_token')

echo $TOKEN
```

### Call Protected API
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8081/api/budgets
```

---

## Useful Commands

```bash
# View logs
docker-compose -f docker-compose.infra.yml logs -f kafka

# Connect to PostgreSQL
docker exec -it procurement-postgres psql -U procurement -d budget_service

# View Kafka topics
docker exec -it procurement-kafka kafka-topics --list --bootstrap-server localhost:9092

# Create Kafka topic
docker exec -it procurement-kafka kafka-topics --create \
  --topic procurement.budget.updated \
  --bootstrap-server localhost:9092

# Stop everything
docker-compose -f docker-compose.infra.yml down

# Stop and remove volumes (clean slate)
docker-compose -f docker-compose.infra.yml down -v
```

---

## Next Steps

1. ✅ Review architecture document
2. ✅ Start local infrastructure
3. ⬜ Create first service (budget-service recommended)
4. ⬜ Setup GitLab repository
5. ⬜ Configure CI/CD pipeline
6. ⬜ Deploy to Kubernetes

---

*Happy Coding! 🚀*
