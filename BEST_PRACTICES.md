# Cross-Cutting Concerns & Best Practices

## Global Standards for All 5 Services

---

## 1. Pagination, Filtering, Search & Sorting

### Standard Query Patterns

All list endpoints should support:
```
GET /api/v1/resources?
  page=1
  limit=20
  sort=created_at:desc
  search=keyword
  filter[status]=approved
  filter[departmentId]=uuid
```

### Sorting Standards

**Format**: `sort=fieldName:direction`
- **Direction**: `asc` (ascending) or `desc` (descending, default)
- **Default**: `created_at:desc` (newest first)
- **Multiple sorts** (if needed): `sort=status:asc,created_at:desc`

**Sortable Fields by Service**:

| Service | Sortable Fields | Default |
|---------|-----------------|---------|
| **User Service** | createdAt, email, firstName, lastName, departmentId | createdAt:desc |
| **Budget Service** | totalAllocated, spentAmount, reservedAmount, createdAt, fiscalYear | createdAt:desc |
| **Requisition Service** | amount, createdAt, status, priority | createdAt:desc |
| **Vendor Service** | name, rating, createdAt, category | name:asc |
| **Order & Payment** | amount, createdAt, status, orderDate | createdAt:desc |

**Query Examples**:
```bash
# Sort by amount descending
GET /api/v1/requisitions?sort=amount:desc

# Sort by name ascending (alphabetical)
GET /api/v1/vendors?sort=name:asc

# Default sort (newest first)
GET /api/v1/budgets?sort=created_at:desc

# Pagination with sort and filter
GET /api/v1/requisitions?page=1&limit=20&sort=amount:desc&status=approved&departmentId=uuid

# Search with sort
GET /api/v1/vendors?search=acme&sort=rating:desc
```

### Response Format (All Services)

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

---

## 2. NestJS Services (User, Vendor)

### 2.1 Request DTOs with Proper Typing

```typescript
// src/dto/pagination.dto.ts
import { Type } from 'class-transformer';
import { IsOptional, IsInt, Min, Max, IsString, IsEnum } from 'class-validator';

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @IsString()
  sort?: string = 'createdAt:desc';

  @IsOptional()
  @IsString()
  search?: string;
}

// Example: User Service
export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsUUID()
  departmentId: string;

  @IsOptional()
  @IsString()
  jobTitle?: string;
}
```

### 2.2 Exception Handling

```typescript
// src/common/filters/http-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof HttpException
      ? exception.message
      : 'Internal server error';

    response.status(status).json({
      statusCode: status,
      message: message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
```

### 2.3 Service Implementation Pattern

```typescript
// src/services/user.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async findAll(paginationDto: PaginationDto) {
    const { page, limit, sort, search } = paginationDto;
    
    const queryBuilder = this.userRepository.createQueryBuilder('user');
    
    if (search) {
      queryBuilder.where(
        'user.firstName ILIKE :search OR user.lastName ILIKE :search OR user.email ILIKE :search',
        { search: `%${search}%` }
      );
    }

    // Apply sorting
    const [field, direction] = sort.split(':');
    queryBuilder.orderBy(`user.${field}`, direction.toUpperCase() as 'ASC' | 'DESC');

    // Pagination
    const [data, total] = await queryBuilder
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }
}
```

---

## 3. Spring Boot Services (Budget, Requisition, Order & Payment)

### 3.1 Request DTOs with Validation

```java
// com.procurement.common.dto.PaginationDto.java
import lombok.Data;
import javax.validation.constraints.Min;
import javax.validation.constraints.Max;

@Data
public class PaginationDto {
    @Min(1)
    private int page = 1;
    
    @Min(1)
    @Max(100)
    private int limit = 20;
    
    private String sort = "createdAt:desc";
    private String search;
}

// Example: Budget Service
import lombok.Data;
import javax.validation.constraints.*;
import java.math.BigDecimal;

@Data
public class CreateBudgetDto {
    @NotNull
    private UUID departmentId;
    
    @NotBlank
    private String fiscalYear;
    
    @NotNull
    @DecimalMin("0.01")
    private BigDecimal totalAllocatedAmount;
    
    @Pattern(regexp = "USD|EUR|GBP")
    private String currency = "USD";
}
```

### 3.2 Global Exception Handler

```java
// com.procurement.common.exception.GlobalExceptionHandler.java
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleResourceNotFound(
            ResourceNotFoundException ex, WebRequest request) {
        
        ErrorResponse error = ErrorResponse.builder()
                .statusCode(HttpStatus.NOT_FOUND.value())
                .message(ex.getMessage())
                .timestamp(LocalDateTime.now())
                .path(request.getDescription(false).replace("uri=", ""))
                .build();
                
        return new ResponseEntity<>(error, HttpStatus.NOT_FOUND);
    }

    @ExceptionHandler(ValidationException.class)
    public ResponseEntity<ErrorResponse> handleValidation(
            ValidationException ex, WebRequest request) {
        
        ErrorResponse error = ErrorResponse.builder()
                .statusCode(HttpStatus.BAD_REQUEST.value())
                .message(ex.getMessage())
                .timestamp(LocalDateTime.now())
                .path(request.getDescription(false).replace("uri=", ""))
                .errors(ex.getErrors())
                .build();
                
        return new ResponseEntity<>(error, HttpStatus.BAD_REQUEST);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGlobalException(
            Exception ex, WebRequest request) {
        
        ErrorResponse error = ErrorResponse.builder()
                .statusCode(HttpStatus.INTERNAL_SERVER_ERROR.value())
                .message("An unexpected error occurred")
                .timestamp(LocalDateTime.now())
                .path(request.getDescription(false).replace("uri=", ""))
                .build();
                
        return new ResponseEntity<>(error, HttpStatus.INTERNAL_SERVER_ERROR);
    }
}

@Data
@Builder
class ErrorResponse {
    private int statusCode;
    private String message;
    private LocalDateTime timestamp;
    private String path;
    private Map<String, String> errors;
}
```

### 3.3 Service Implementation Pattern

```java
// com.procurement.budget.service.BudgetService.java
import org.springframework.data.domain.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class BudgetService {

    private final BudgetRepository budgetRepository;

    public BudgetService(BudgetRepository budgetRepository) {
        this.budgetRepository = budgetRepository;
    }

    public Page<Budget> findAll(PaginationDto dto) {
        // Parse sort
        String[] sortParts = dto.getSort().split(":");
        String field = sortParts[0];
        String direction = sortParts.length > 1 ? sortParts[1] : "desc";
        
        Sort sort = direction.equalsIgnoreCase("asc") 
            ? Sort.by(field).ascending() 
            : Sort.by(field).descending();
        
        Pageable pageable = PageRequest.of(dto.getPage() - 1, dto.getLimit(), sort);
        
        // Search if provided
        if (dto.getSearch() != null && !dto.getSearch().isEmpty()) {
            return budgetRepository.searchBudgets(dto.getSearch(), pageable);
        }
        
        return budgetRepository.findAll(pageable);
    }

    public Budget findById(UUID id) {
        return budgetRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Budget not found with id: " + id));
    }

    public Budget create(CreateBudgetDto dto) {
        // Validate department exists
        // Check for duplicate fiscal year
        // Create budget
        Budget budget = Budget.builder()
            .departmentId(dto.getDepartmentId())
            .fiscalYear(dto.getFiscalYear())
            .totalAllocatedAmount(dto.getTotalAllocatedAmount())
            .currency(dto.getCurrency())
            .build();
            
        return budgetRepository.save(budget);
    }
}
```

---

## 4. Event-Driven Communication (Kafka)

### 4.1 Event Standards

**Event Naming Convention**: `<service>.<entity>.<action>`

Examples:
- `user.user.created`
- `budget.reservation.created`
- `requisition.request.approved`
- `vendor.quotation.submitted`
- `order.payment.processed`

### 4.2 Event Structure

```json
{
  "eventId": "uuid",
  "eventType": "user.user.created",
  "timestamp": "2024-01-22T10:30:00Z",
  "source": "user-service",
  "version": "1.0",
  "data": {
    "userId": "uuid",
    "email": "john.doe@example.com",
    "departmentId": "uuid"
  },
  "metadata": {
    "correlationId": "uuid",
    "userId": "uuid"
  }
}
```

### 4.3 NestJS Event Producer

```typescript
// src/kafka/kafka-producer.service.ts
import { Injectable } from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';

@Injectable()
export class KafkaProducerService {
  private producer: Producer;

  constructor() {
    const kafka = new Kafka({
      clientId: 'user-service',
      brokers: [process.env.KAFKA_BROKER || 'localhost:29092'],
    });
    this.producer = kafka.producer();
  }

  async onModuleInit() {
    await this.producer.connect();
  }

  async publishEvent(topic: string, event: any) {
    await this.producer.send({
      topic,
      messages: [
        {
          key: event.eventId,
          value: JSON.stringify(event),
        },
      ],
    });
  }
}
```

### 4.4 Spring Boot Event Producer

```java
// com.procurement.common.event.EventProducer.java
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;
import java.util.UUID;

@Component
public class EventProducer {

    private final KafkaTemplate<String, String> kafkaTemplate;

    public EventProducer(KafkaTemplate<String, String> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    public void publishEvent(String topic, Object eventData) {
        Event event = Event.builder()
            .eventId(UUID.randomUUID().toString())
            .eventType(topic)
            .timestamp(LocalDateTime.now())
            .source(getServiceName())
            .data(eventData)
            .build();
            
        kafkaTemplate.send(topic, event.getEventId(), toJson(event));
    }
}
```

---

## 5. Authentication & Authorization

### 5.1 Keycloak JWT Validation (All Services)

**NestJS (User, Vendor Services)**:

```typescript
// src/auth/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
      algorithms: ['RS256'],
    });
  }

  async validate(payload: any) {
    return {
      userId: payload.sub,
      email: payload.email,
      roles: payload.realm_access?.roles || [],
    };
  }
}
```

**Spring Boot (Budget, Requisition, Order & Payment Services)**:

```java
// com.procurement.config.SecurityConfig.java
import org.springframework.context.annotation.Bean;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/v1/health").permitAll()
                .requestMatchers("/api/v1/budgets/**").hasAnyRole("FINANCE", "ADMIN")
                .requestMatchers("/api/v1/requisitions/**").hasAnyRole("REQUESTER", "MANAGER", "ADMIN")
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth2 -> oauth2.jwt());
        return http.build();
    }
}
```

### 5.2 Role-Based Access Control

| Role | Permissions |
|------|-------------|
| **REQUESTER** | Create/view own requisitions, view vendors |
| **MANAGER** | Approve level-1 requisitions, view department budgets |
| **FINANCE** | Approve level-2 requisitions, manage budgets, process payments |
| **ADMIN** | Full access to all services |

---

## 6. Database Best Practices

### 6.1 Connection Pooling

**NestJS (TypeORM)**:
```typescript
// app.module.ts
TypeOrmModule.forRoot({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  synchronize: false, // Use migrations in production
  logging: process.env.NODE_ENV === 'development',
  extra: {
    max: 20,
    min: 5,
    idle: 10000,
  },
}),
```

**Spring Boot (JPA)**:
```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
      idle-timeout: 600000
      connection-timeout: 30000
```

### 6.2 Transaction Management

**Always use transactions for:**
- Budget reservations
- Approval workflows
- Payment processing
- Any multi-step financial operations

```java
@Transactional(isolation = Isolation.SERIALIZABLE)
public void reserveBudget(UUID requestId, BigDecimal amount) {
    // Lock budget row
    // Check availability
    // Create reservation
    // Update budget amounts
}
```

---

## 7. Logging & Monitoring

### 7.1 Structured Logging

**NestJS**:
```typescript
this.logger.log({
  action: 'user.created',
  userId: user.id,
  timestamp: new Date(),
  metadata: { ip: request.ip }
});
```

**Spring Boot**:
```java
log.info("Budget created: budgetId={}, departmentId={}, amount={}", 
    budget.getId(), budget.getDepartmentId(), budget.getTotalAllocatedAmount());
```

### 7.2 Health Checks

**All services must expose**: `GET /api/v1/health`

```json
{
  "status": "UP",
  "service": "budget-service",
  "timestamp": "2024-01-22T10:30:00Z",
  "checks": {
    "database": "UP",
    "kafka": "UP",
    "redis": "UP"
  }
}
```

---

## 8. Testing Standards

### 8.1 Unit Tests
- **Coverage**: Minimum 80% for business logic
- **Tools**: Jest (NestJS), JUnit 5 + Mockito (Spring Boot)

### 8.2 Integration Tests
- Test with real database (testcontainers)
- Test Kafka events
- Test API endpoints

### 8.3 E2E Tests
- Critical user flows (request creation → approval → order)
- Budget reservation workflows
- Payment processing

---

## Summary Checklist

✅ All list endpoints support pagination, filtering, sorting  
✅ Standard response format across all services  
✅ Global exception handling configured  
✅ Event-driven communication via Kafka  
✅ JWT authentication with Keycloak  
✅ Role-based access control  
✅ Structured logging  
✅ Health check endpoints  
✅ Database connection pooling  
✅ Transaction management for critical operations  
✅ Test coverage >= 80%
