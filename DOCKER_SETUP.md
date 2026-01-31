# Docker Setup Guide

Complete guide for setting up and managing the Docker infrastructure for the procurement system.

---

## Table of Contents
1. [Infrastructure Services Overview](#infrastructure-services-overview)
2. [Quick Start](#quick-start)
3. [Service Configuration Details](#service-configuration-details)
4. [Development Setup](#development-setup)
5. [Production Considerations](#production-considerations)
6. [Troubleshooting](#troubleshooting)

---

## Infrastructure Services Overview

The procurement system uses the following infrastructure services:

| Service | Purpose | Port(s) | UI Access |
|---------|---------|---------|-----------|
| **PostgreSQL** | Database for all microservices | 5432 | - |
| **Redis** | Caching and session storage | 6379 | - |
| **Kafka + Zookeeper** | Event streaming | 9092, 29092, 2181 | - |
| **Kafka UI** | Kafka management interface | 8080 | http://localhost:8080 |
| **Keycloak** | Identity & Access Management | 8080 | http://localhost:8080 |
| **Vault** | Secrets management | 8200 | http://localhost:8200 |
| **Mailhog** | Email testing (SMTP catch-all) | 1025, 8025 | http://localhost:8025 |
| **Elasticsearch** | Audit log storage & search | 9200 | http://localhost:9200 |
| **MinIO** | S3-compatible file storage | 9000, 9001 | http://localhost:9001 |

---

## Quick Start

### Prerequisites
```bash
# Check Docker is installed
docker --version
docker-compose --version

# Minimum requirements:
# - Docker 20.10+
# - Docker Compose 2.0+
# - 8GB RAM available
# - 20GB disk space
```

### Start All Infrastructure
```bash
# Navigate to project root
cd /path/to/procurement-system

# Start all services in detached mode
docker-compose -f docker-compose.infra.yml up -d

# Wait for services to be healthy (~60 seconds)
docker-compose -f docker-compose.infra.yml ps

# View logs
docker-compose -f docker-compose.infra.yml logs -f

# View specific service logs
docker-compose -f docker-compose.infra.yml logs -f postgres
docker-compose -f docker-compose.infra.yml logs -f keycloak
```

### Verify Services
```bash
# Check all services are running
docker-compose -f docker-compose.infra.yml ps

# Should show all services as "Up" and "healthy"
```

### Stop All Services
```bash
# Stop services (preserves data)
docker-compose -f docker-compose.infra.yml stop

# Stop and remove containers (preserves volumes)
docker-compose -f docker-compose.infra.yml down

# Stop, remove containers AND volumes (WARNING: deletes all data)
docker-compose -f docker-compose.infra.yml down -v
```

---

## Service Configuration Details

### 1. PostgreSQL

**Purpose**: Primary database for all microservices

**Configuration**:
```yaml
postgres:
  image: postgres:15-alpine
  environment:
    POSTGRES_USER: procurement
    POSTGRES_PASSWORD: procurement123
    POSTGRES_DB: procurement
  ports:
    - "5432:5432"
  volumes:
    - postgres_data:/var/lib/postgresql/data
    - ./init-databases.sql:/docker-entrypoint-initdb.d/init.sql
```

**Create Service Databases**:
```sql
-- init-databases.sql
CREATE DATABASE user_service;
CREATE DATABASE budget_service;
CREATE DATABASE requisition_service;
CREATE DATABASE vendor_service;
CREATE DATABASE order_payment_service;
CREATE DATABASE keycloak;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE user_service TO procurement;
GRANT ALL PRIVILEGES ON DATABASE budget_service TO procurement;
GRANT ALL PRIVILEGES ON DATABASE requisition_service TO procurement;
GRANT ALL PRIVILEGES ON DATABASE vendor_service TO procurement;
GRANT ALL PRIVILEGES ON DATABASE order_payment_service TO procurement;
GRANT ALL PRIVILEGES ON DATABASE keycloak TO procurement;
```

**Connect to PostgreSQL**:
```bash
# Using psql
docker exec -it procurement-postgres psql -U procurement -d procurement

# Using external client
psql -h localhost -p 5432 -U procurement -d user_service
# Password: procurement123

# List databases
\l

# Connect to specific database
\c user_service

# List tables
\dt
```

**Backup & Restore**:
```bash
# Backup database
docker exec procurement-postgres pg_dump -U procurement user_service > user_service_backup.sql

# Restore database
docker exec -i procurement-postgres psql -U procurement user_service < user_service_backup.sql
```

---

### 2. Redis

**Purpose**: Caching, session storage, rate limiting

**Configuration**:
```yaml
redis:
  image: redis:7-alpine
  ports:
    - "6379:6379"
  volumes:
    - redis_data:/data
```

**Connect to Redis**:
```bash
# Using redis-cli
docker exec -it procurement-redis redis-cli

# Test connection
127.0.0.1:6379> PING
PONG

# List all keys
127.0.0.1:6379> KEYS *

# Get value
127.0.0.1:6379> GET user:session:abc123

# Clear all data (be careful!)
127.0.0.1:6379> FLUSHALL
```

**Common Redis Commands**:
```bash
# Set value with expiration
SET cache:user:123 '{"name":"John"}' EX 3600

# Get value
GET cache:user:123

# Delete key
DEL cache:user:123

# Check if key exists
EXISTS cache:user:123

# Get TTL
TTL cache:user:123
```

---

### 3. Kafka + Zookeeper

**Purpose**: Event streaming and inter-service communication

**Configuration**:
```yaml
kafka:
  image: confluentinc/cp-kafka:7.5.0
  environment:
    KAFKA_BROKER_ID: 1
    KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
    KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092,PLAINTEXT_HOST://localhost:29092
  ports:
    - "9092:9092"   # Internal
    - "29092:29092" # External (use this from host)
```

**Create Topics**:
```bash
# Access Kafka container
docker exec -it procurement-kafka bash

# Create topic
kafka-topics --create \
  --bootstrap-server localhost:9092 \
  --topic user.user.created \
  --partitions 3 \
  --replication-factor 1

# List topics
kafka-topics --list --bootstrap-server localhost:9092

# Describe topic
kafka-topics --describe \
  --bootstrap-server localhost:9092 \
  --topic user.user.created

# Delete topic
kafka-topics --delete \
  --bootstrap-server localhost:9092 \
  --topic user.user.created
```

**Produce & Consume Messages**:
```bash
# Produce message
kafka-console-producer \
  --bootstrap-server localhost:9092 \
  --topic user.user.created

# Consume messages
kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic user.user.created \
  --from-beginning

# Consumer with group
kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic user.user.created \
  --group my-consumer-group
```

**Common Topics**:
```bash
# User Service
user.user.created
user.user.updated
user.department.created

# Budget Service
budget.reservation.created
budget.reservation.released
budget.topup.approved

# Requisition Service
requisition.request.created
requisition.request.approved
requisition.request.rejected

# Vendor Service
vendor.quotation.submitted
vendor.vendor.created

# Order & Payment Service
order.order.created
order.payment.processed
```

---

### 4. Kafka UI

**Purpose**: Web interface for managing Kafka topics, consumers, messages

**Access**: http://localhost:9000

**Features**:
- View topics and messages
- Monitor consumer groups
- View broker details
- Search messages
- Create/delete topics

---

### 5. Keycloak

**Purpose**: Identity and Access Management (IAM), OAuth2/OIDC provider

**Configuration**:
```yaml
keycloak:
  image: quay.io/keycloak/keycloak:23.0
  command: start-dev --import-realm
  environment:
    KEYCLOAK_ADMIN: admin
    KEYCLOAK_ADMIN_PASSWORD: admin
    KC_DB: postgres
    KC_DB_URL: jdbc:postgresql://postgres:5432/keycloak
  ports:
    - "8080:8080"
  volumes:
    - ./keycloak/realm-export.json:/opt/keycloak/data/import/realm-export.json
```

**Access**:
- **Admin Console**: http://localhost:8080
- **Username**: admin
- **Password**: admin

**Test Users** (defined in realm-export.json):
| Username | Password | Roles |
|----------|----------|-------|
| admin | admin123 | ADMIN, FINANCE |
| finance.user | finance123 | FINANCE |
| manager.user | manager123 | MANAGER |
| requester.user | requester123 | REQUESTER |

**Get Access Token**:
```bash
# Request token for a user
curl -X POST http://localhost:8080/realms/procurement/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=requester.user" \
  -d "password=requester123" \
  -d "grant_type=password" \
  -d "client_id=procurement-client" \
  -d "client_secret=your-client-secret"

# Response contains access_token
```

**Verify Token**:
```bash
# Decode JWT (use jwt.io or)
echo "eyJhbGc..." | base64 -d
```

---

### 6. HashiCorp Vault

**Purpose**: Secrets management (API keys, database passwords, encryption keys)

**Configuration**:
```yaml
vault:
  image: hashicorp/vault:1.15
  environment:
    VAULT_DEV_ROOT_TOKEN_ID: root
    VAULT_DEV_LISTEN_ADDRESS: 0.0.0.0:8200
  ports:
    - "8200:8200"
```

**Access**:
- **UI**: http://localhost:8200
- **Token**: root

**Store Secrets**:
```bash
# Set Vault address
export VAULT_ADDR='http://localhost:8200'
export VAULT_TOKEN='root'

# Store secret
vault kv put secret/database/user-service \
  username=procurement \
  password=procurement123

# Read secret
vault kv get secret/database/user-service

# Store JWT secret
vault kv put secret/jwt \
  secret=your-super-secret-key-change-in-production
```

**Integrate with Services**:
```typescript
// NestJS example
import * as vault from 'node-vault';

const vaultClient = vault({
  endpoint: 'http://localhost:8200',
  token: 'root',
});

const secrets = await vaultClient.read('secret/data/database/user-service');
const dbPassword = secrets.data.data.password;
```

---

### 7. Mailhog

**Purpose**: Email testing - catches all outgoing emails

**Configuration**:
```yaml
mailhog:
  image: mailhog/mailhog:latest
  ports:
    - "1025:1025"  # SMTP server
    - "8025:8025"  # Web UI
```

**Access**:
- **Web UI**: http://localhost:8025

**Send Test Email**:
```bash
# Using curl
curl -X POST http://localhost:1025 \
  -H "Content-Type: message/rfc822" \
  --data-binary @- << EOF
From: system@procurement.com
To: user@example.com
Subject: Test Email

This is a test email.
EOF
```

**NestJS Integration**:
```typescript
// app.module.ts
import { MailerModule } from '@nestjs-modules/mailer';

MailerModule.forRoot({
  transport: {
    host: 'localhost',
    port: 1025,
    secure: false,
  },
});
```

---

### 8. Elasticsearch

**Purpose**: Audit log storage and full-text search

**Configuration**:
```yaml
elasticsearch:
  image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
  environment:
    - discovery.type=single-node
    - xpack.security.enabled=false
    - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
  ports:
    - "9200:9200"
```

**Access**: http://localhost:9200

**Create Index**:
```bash
# Create audit log index
curl -X PUT http://localhost:9200/audit-logs \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "number_of_shards": 1,
      "number_of_replicas": 0
    },
    "mappings": {
      "properties": {
        "timestamp": { "type": "date" },
        "service": { "type": "keyword" },
        "action": { "type": "keyword" },
        "userId": { "type": "keyword" },
        "details": { "type": "text" }
      }
    }
  }'

# Index document
curl -X POST http://localhost:9200/audit-logs/_doc \
  -H "Content-Type: application/json" \
  -d '{
    "timestamp": "2024-01-22T10:30:00Z",
    "service": "user-service",
    "action": "user.created",
    "userId": "uuid",
    "details": "User john.doe@example.com created"
  }'

# Search
curl http://localhost:9200/audit-logs/_search?q=action:user.created
```

---

## Development Setup

### Environment Variables

Create a `.env` file in project root:

```env
# PostgreSQL
POSTGRES_USER=procurement
POSTGRES_PASSWORD=procurement123
POSTGRES_DB=procurement

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Kafka
KAFKA_BROKER=localhost:29092

# Keycloak
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=procurement
KEYCLOAK_CLIENT_ID=procurement-client
KEYCLOAK_CLIENT_SECRET=your-client-secret

# Vault
VAULT_ADDR=http://localhost:8200
VAULT_TOKEN=root

# Mailhog
MAIL_HOST=localhost
MAIL_PORT=1025

# Elasticsearch
ELASTICSEARCH_URL=http://localhost:9200
```

### Service-Specific Configuration

**NestJS Services (User, Vendor)**:
```env
# .env
NODE_ENV=development
DATABASE_URL=postgresql://procurement:procurement123@localhost:5432/user_service
JWT_SECRET=your-secret-key
KEYCLOAK_URL=http://localhost:8080
KAFKA_BROKER=localhost:29092
REDIS_URL=redis://localhost:6379
```

**Spring Boot Services (Budget, Requisition, Order & Payment)**:
```yaml
# application.yml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/budget_service
    username: procurement
    password: procurement123
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: http://localhost:8080/realms/procurement
  kafka:
    bootstrap-servers: localhost:29092
  data:
    redis:
      host: localhost
      port: 6379
```

---

## Production Considerations

### 1. Security

**Don't use default passwords**:
```yaml
# Use strong passwords from Vault
postgres:
  environment:
    POSTGRES_PASSWORD: ${VAULT_DB_PASSWORD}

keycloak:
  environment:
    KEYCLOAK_ADMIN_PASSWORD: ${VAULT_KEYCLOAK_PASSWORD}
```

**Enable authentication**:
```yaml
# Kafka SASL/SSL
kafka:
  environment:
    KAFKA_SECURITY_PROTOCOL: SASL_SSL
    KAFKA_SASL_MECHANISM: PLAIN

# Elasticsearch security
elasticsearch:
  environment:
    xpack.security.enabled: true
```

### 2. High Availability

**PostgreSQL replication**:
```yaml
postgres-primary:
  image: postgres:15-alpine
  
postgres-replica:
  image: postgres:15-alpine
  environment:
    POSTGRES_PRIMARY_HOST: postgres-primary
```

**Kafka cluster**:
```yaml
kafka-1:
  environment:
    KAFKA_BROKER_ID: 1

kafka-2:
  environment:
    KAFKA_BROKER_ID: 2

kafka-3:
  environment:
    KAFKA_BROKER_ID: 3
```

### 3. Monitoring

**Add Prometheus & Grafana**:
```yaml
prometheus:
  image: prom/prometheus:latest
  ports:
    - "9090:9090"
  volumes:
    - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml

grafana:
  image: grafana/grafana:latest
  ports:
    - "3000:3000"
```

### 4. Resource Limits

```yaml
services:
  postgres:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G

  kafka:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
```

---

## Troubleshooting

### Issue: Services not starting

```bash
# Check logs
docker-compose -f docker-compose.infra.yml logs

# Check specific service
docker-compose -f docker-compose.infra.yml logs postgres

# Restart service
docker-compose -f docker-compose.infra.yml restart postgres
```

### Issue: Port conflicts

```bash
# Check what's using port
lsof -i :5432

# Change port in docker-compose.yml
ports:
  - "5433:5432"  # Use different host port
```

### Issue: Out of memory

```bash
# Check Docker resources
docker stats

# Increase Docker Desktop memory limit
# Docker Desktop > Preferences > Resources > Memory
```

### Issue: Kafka not producing/consuming

```bash
# Check Kafka logs
docker-compose -f docker-compose.infra.yml logs kafka

# List topics
docker exec procurement-kafka kafka-topics --list --bootstrap-server localhost:9092

# Check consumer lag
docker exec procurement-kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --describe --group my-group
```

### Issue: Database connection refused

```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# Check PostgreSQL logs
docker logs procurement-postgres

# Test connection
docker exec procurement-postgres pg_isready -U procurement

# Connect manually
docker exec -it procurement-postgres psql -U procurement
```

### Issue: Keycloak not accessible

```bash
# Check if Keycloak is fully started (takes ~30 seconds)
docker logs procurement-keycloak

# Wait for message: "Keycloak 23.0 started in XXXms"
```

### Issue: MinIO console not accessible

```bash
# Check MinIO is running
docker ps | grep minio

# Check MinIO logs
docker logs procurement-minio

# Test API endpoint
curl http://localhost:9000/minio/health/live

# Access MinIO console
# URL: http://localhost:9001
# Username: minioadmin
# Password: minioadmin123
```

### Issue: MinIO bucket not created

```bash
# Check minio-init logs
docker logs procurement-minio-init

# Manually create bucket
docker exec -it procurement-minio mc alias set myminio http://localhost:9000 minioadmin minioadmin123
docker exec -it procurement-minio mc mb myminio/procurement-files
```

---

## 9. MinIO (File Storage)

**Purpose**: S3-compatible object storage for file attachments

**Configuration**:
```yaml
minio:
  image: minio/minio:latest
  command: server /data --console-address ":9001"
  environment:
    MINIO_ROOT_USER: minioadmin
    MINIO_ROOT_PASSWORD: minioadmin123
  ports:
    - "9000:9000"  # API
    - "9001:9001"  # Web Console
```

**Access MinIO Console**:
- URL: http://localhost:9001
- Username: `minioadmin`
- Password: `minioadmin123`

**Bucket Structure**:
```
procurement-files/
├── attachments/
│   ├── requests/
│   ├── quotations/
│   ├── invoices/
│   └── purchase-orders/
├── templates/
└── exports/
```

**Upload a Test File**:
```bash
# Using MinIO CLI (mc)
docker exec -it procurement-minio mc alias set local http://localhost:9000 minioadmin minioadmin123

# Upload file
docker exec -it procurement-minio mc cp /path/to/file.pdf local/procurement-files/attachments/requests/

# List files
docker exec -it procurement-minio mc ls local/procurement-files/attachments/requests/

# Download file
docker exec -it procurement-minio mc cp local/procurement-files/attachments/requests/file.pdf /path/to/destination/
```

**S3 SDK Example (Node.js)**:
```javascript
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin123',
  },
  forcePathStyle: true,
});

// Upload file
await s3Client.send(new PutObjectCommand({
  Bucket: 'procurement-files',
  Key: 'attachments/requests/test.pdf',
  Body: fileBuffer,
}));
```

---

## Useful Commands

### View all containers
```bash
docker ps -a
```

### View resource usage
```bash
docker stats
```

### Clean up unused resources
```bash
# Remove stopped containers
docker container prune

# Remove unused images
docker image prune

# Remove unused volumes
docker volume prune

# Remove everything (careful!)
docker system prune -a --volumes
```

### Backup volumes
```bash
# Backup PostgreSQL volume
docker run --rm \
  -v procurement_postgres_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/postgres_backup.tar.gz /data
```

### Restore volumes
```bash
# Restore PostgreSQL volume
docker run --rm \
  -v procurement_postgres_data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/postgres_backup.tar.gz -C /
```

---

## Summary Checklist

✅ Docker and Docker Compose installed  
✅ 8GB RAM and 20GB disk space available  
✅ All infrastructure services started  
✅ Service databases created  
✅ Keycloak realm imported  
✅ Test users configured  
✅ Kafka topics created  
✅ **MinIO bucket created (procurement-files)** - NEW  
✅ Environment variables configured  
✅ Services can connect to infrastructure  
✅ Secrets stored in Vault (production)  
✅ **File storage tested with MinIO** - NEW  

**Next Steps**: See [DEVELOPER_QUICKSTART.md](DEVELOPER_QUICKSTART.md) to start developing microservices.
