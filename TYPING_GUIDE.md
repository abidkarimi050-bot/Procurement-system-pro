# Complete Typing Guide for NestJS & Spring Boot

**ORM Stack**: TypeORM (NestJS) + Spring Data JPA (Spring Boot)

## Table of Contents
1. [NestJS TypeScript Typing](#nestjs-typescript-typing)
2. [Spring Boot Java Typing](#spring-boot-java-typing)
3. [Shared Domain Models](#shared-domain-models)

---

## NestJS TypeScript Typing

**Framework**: NestJS 10.x  
**ORM**: TypeORM 0.3.x  
**Database**: PostgreSQL 15

### 1. Basic Entity Typing

```typescript
// src/common/types/base.entity.ts
import { PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

### 2. User Service Types

```typescript
// src/entities/department.entity.ts
import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { BaseEntity } from '../common/types/base.entity';
import { User } from './user.entity';

@Entity('departments')
export class Department extends BaseEntity {
  @Column({ length: 100 })
  name: string;

  @Column({ length: 20, unique: true })
  code: string;

  @Column({ type: 'uuid', nullable: true })
  parentId: string | null;

  @ManyToOne(() => Department, { nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent: Department | null;

  @Column({ type: 'uuid', nullable: true })
  managerId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'manager_id' })
  manager: User | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ length: 50, nullable: true })
  costCenter: string | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'uuid' })
  createdBy: string;

  @Column({ type: 'uuid', nullable: true })
  updatedBy: string | null;

  @OneToMany(() => User, user => user.department)
  users: User[];
}

// src/entities/user.entity.ts
import { Entity, Column, ManyToOne, ManyToMany, JoinTable, JoinColumn } from 'typeorm';
import { BaseEntity } from '../common/types/base.entity';
import { Department } from './department.entity';
import { Role } from './role.entity';

@Entity('users')
export class User extends BaseEntity {
  @Column({ length: 100, unique: true })
  keycloakId: string;

  @Column({ length: 255, unique: true })
  email: string;

  @Column({ length: 100 })
  firstName: string;

  @Column({ length: 100 })
  lastName: string;

  @Column({ length: 50, unique: true, nullable: true })
  employeeId: string | null;

  @Column({ type: 'uuid', nullable: true })
  departmentId: string | null;

  @ManyToOne(() => Department, department => department.users)
  @JoinColumn({ name: 'department_id' })
  department: Department | null;

  @Column({ length: 100, nullable: true })
  jobTitle: string | null;

  @Column({ length: 20, nullable: true })
  phone: string | null;

  @Column({ default: true })
  isActive: boolean;

  @ManyToMany(() => Role, role => role.users)
  @JoinTable({
    name: 'user_roles',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles: Role[];
}

// src/entities/role.entity.ts
import { Entity, Column, ManyToMany } from 'typeorm';
import { BaseEntity } from '../common/types/base.entity';
import { User } from './user.entity';

export enum RoleName {
  REQUESTER = 'REQUESTER',
  MANAGER = 'MANAGER',
  FINANCE = 'FINANCE',
  ADMIN = 'ADMIN',
}

@Entity('roles')
export class Role extends BaseEntity {
  @Column({ type: 'enum', enum: RoleName, unique: true })
  name: RoleName;

  @Column({ length: 255, nullable: true })
  description: string | null;

  @ManyToMany(() => User, user => user.roles)
  users: User[];
}
```

### 3. User Service DTOs

```typescript
// src/dto/create-user.dto.ts
import { IsString, IsEmail, IsUUID, IsOptional, IsBoolean } from 'class-validator';

export class CreateUserDto {
  @IsString()
  keycloakId: string;

  @IsEmail()
  email: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  jobTitle?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

// src/dto/update-user.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import { IsOptional, IsBoolean } from 'class-validator';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// src/dto/user-response.dto.ts
export class UserResponseDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  employeeId: string | null;
  departmentId: string | null;
  department?: {
    id: string;
    name: string;
    code: string;
  };
  jobTitle: string | null;
  phone: string | null;
  isActive: boolean;
  roles: string[];
  createdAt: Date;
  updatedAt: Date;
}
```

### 4. Vendor Service Types

```typescript
// src/entities/vendor.entity.ts
import { Entity, Column, OneToMany } from 'typeorm';
import { BaseEntity } from '../common/types/base.entity';
import { Quotation } from './quotation.entity';

export enum VendorCategory {
  OFFICE_SUPPLIES = 'office-supplies',
  EQUIPMENT = 'equipment',
  SERVICES = 'services',
  CONSULTING = 'consulting',
  SOFTWARE = 'software',
  OTHER = 'other',
}

export enum VendorStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  BLOCKED = 'blocked',
}

@Entity('vendors')
export class Vendor extends BaseEntity {
  @Column({ length: 255 })
  name: string;

  @Column({ length: 255, unique: true })
  email: string;

  @Column({ length: 20, nullable: true })
  phone: string | null;

  @Column({ length: 255, nullable: true })
  website: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ length: 100, nullable: true })
  city: string | null;

  @Column({ length: 50, nullable: true })
  state: string | null;

  @Column({ length: 20, nullable: true })
  zipCode: string | null;

  @Column({ length: 100, default: 'USA' })
  country: string;

  @Column({ length: 50, nullable: true })
  taxId: string | null;

  @Column({ type: 'enum', enum: VendorCategory })
  category: VendorCategory;

  @Column({ type: 'enum', enum: VendorStatus, default: VendorStatus.ACTIVE })
  status: VendorStatus;

  @Column({ type: 'decimal', precision: 3, scale: 2, nullable: true })
  rating: number | null;

  @Column({ length: 255, nullable: true })
  bankName: string | null;

  @Column({ length: 50, nullable: true })
  bankAccount: string | null;

  @Column({ length: 50, nullable: true })
  paymentTerms: string | null;

  @Column({ type: 'uuid' })
  createdBy: string;

  @OneToMany(() => Quotation, quotation => quotation.vendor)
  quotations: Quotation[];
}

// src/entities/rfq-request.entity.ts
import { Entity, Column, OneToMany } from 'typeorm';
import { BaseEntity } from '../common/types/base.entity';
import { Quotation } from './quotation.entity';

export enum RfqStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  CLOSED = 'closed',
  CANCELLED = 'cancelled',
}

@Entity('rfq_requests')
export class RfqRequest extends BaseEntity {
  @Column({ type: 'uuid' })
  purchaseRequestId: string;

  @Column({ length: 255 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'timestamp' })
  deadline: Date;

  @Column({ type: 'enum', enum: RfqStatus, default: RfqStatus.DRAFT })
  status: RfqStatus;

  @Column({ type: 'uuid' })
  createdBy: string;

  @Column({ type: 'timestamp', nullable: true })
  publishedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  closedAt: Date | null;

  @OneToMany(() => Quotation, quotation => quotation.rfq)
  quotations: Quotation[];
}

// src/entities/quotation.entity.ts
import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { BaseEntity } from '../common/types/base.entity';
import { Vendor } from './vendor.entity';
import { RfqRequest } from './rfq-request.entity';
import { QuotationLineItem } from './quotation-line-item.entity';

export enum QuotationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

@Entity('quotations')
export class Quotation extends BaseEntity {
  @Column({ type: 'uuid' })
  rfqId: string;

  @ManyToOne(() => RfqRequest, rfq => rfq.quotations)
  @JoinColumn({ name: 'rfq_id' })
  rfq: RfqRequest;

  @Column({ type: 'uuid' })
  vendorId: string;

  @ManyToOne(() => Vendor, vendor => vendor.quotations)
  @JoinColumn({ name: 'vendor_id' })
  vendor: Vendor;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  totalAmount: number;

  @Column({ length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'date' })
  validUntil: Date;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'enum', enum: QuotationStatus, default: QuotationStatus.PENDING })
  status: QuotationStatus;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @OneToMany(() => QuotationLineItem, item => item.quotation)
  lineItems: QuotationLineItem[];
}

// src/entities/quotation-line-item.entity.ts
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../common/types/base.entity';
import { Quotation } from './quotation.entity';

@Entity('quotation_line_items')
export class QuotationLineItem extends BaseEntity {
  @Column({ type: 'uuid' })
  quotationId: string;

  @ManyToOne(() => Quotation, quotation => quotation.lineItems)
  @JoinColumn({ name: 'quotation_id' })
  quotation: Quotation;

  @Column({ length: 255 })
  itemName: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  totalPrice: number;

  @Column({ length: 50, nullable: true })
  deliveryTime: string | null;
}
```

### 5. Common Types & Interfaces

```typescript
// src/common/types/pagination.interface.ts
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
  meta?: {
    timestamp: string;
    version: string;
  };
}

// src/common/types/event.interface.ts
export interface KafkaEvent<T = any> {
  eventId: string;
  eventType: string;
  timestamp: Date;
  source: string;
  version: string;
  data: T;
  metadata?: {
    correlationId?: string;
    userId?: string;
  };
}
```

---

## Spring Boot Java Typing

**Framework**: Spring Boot 3.2.x  
**ORM**: Spring Data JPA (Hibernate)  
**Database**: PostgreSQL 15

### 1. Base Entity

```java
// com.procurement.common.entity.BaseEntity.java
package com.procurement.common.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.UUID;

@Data
@MappedSuperclass
public abstract class BaseEntity {
    
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;
    
    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
```

### 2. Budget Service Types

```java
// com.procurement.budget.entity.Budget.java
package com.procurement.budget.entity;

import com.procurement.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "budgets")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Budget extends BaseEntity {
    
    @Column(name = "department_id", nullable = false)
    private UUID departmentId;
    
    @Column(name = "fiscal_year", length = 4, nullable = false)
    private String fiscalYear;
    
    @Column(name = "total_allocated_amount", precision = 15, scale = 2, nullable = false)
    private BigDecimal totalAllocatedAmount;
    
    @Column(name = "spent_amount", precision = 15, scale = 2, nullable = false)
    private BigDecimal spentAmount = BigDecimal.ZERO;
    
    @Column(name = "reserved_amount", precision = 15, scale = 2, nullable = false)
    private BigDecimal reservedAmount = BigDecimal.ZERO;
    
    @Column(length = 3)
    private String currency = "USD";
    
    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private BudgetStatus status = BudgetStatus.ACTIVE;
    
    @Column(name = "allocated_at", nullable = false)
    private LocalDateTime allocatedAt;
    
    @Column(name = "allocated_by", nullable = false)
    private UUID allocatedBy;
    
    @Column(name = "closed_at")
    private LocalDateTime closedAt;
    
    // Calculated field (not stored in DB)
    @Transient
    public BigDecimal getAvailableAmount() {
        return totalAllocatedAmount
            .subtract(spentAmount)
            .subtract(reservedAmount);
    }
}

// com.procurement.budget.entity.BudgetStatus.java
package com.procurement.budget.entity;

public enum BudgetStatus {
    ACTIVE,
    CLOSED,
    SUSPENDED
}

// com.procurement.budget.entity.BudgetReservation.java
package com.procurement.budget.entity;

import com.procurement.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "budget_reservations")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BudgetReservation extends BaseEntity {
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "budget_id", nullable = false)
    private Budget budget;
    
    @Column(name = "purchase_request_id", nullable = false, unique = true)
    private UUID purchaseRequestId;
    
    @Column(name = "order_id")
    private UUID orderId;
    
    @Column(name = "amount_reserved", precision = 15, scale = 2, nullable = false)
    private BigDecimal amountReserved;
    
    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private ReservationStatus status = ReservationStatus.RESERVED;
    
    @Column(name = "expiry_date")
    private LocalDateTime expiryDate;
    
    @Column(name = "released_at")
    private LocalDateTime releasedAt;
    
    @Column(name = "spent_at")
    private LocalDateTime spentAt;
    
    @Column(name = "created_by", nullable = false)
    private UUID createdBy;
}

// com.procurement.budget.entity.ReservationStatus.java
package com.procurement.budget.entity;

public enum ReservationStatus {
    RESERVED,
    CONFIRMED,
    PARTIALLY_SPENT,
    SPENT,
    RELEASED,
    CANCELLED
}
```

### 3. Requisition Service Types

```java
// com.procurement.requisition.entity.PurchaseRequest.java
package com.procurement.requisition.entity;

import com.procurement.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "purchase_requests")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PurchaseRequest extends BaseEntity {
    
    @Column(nullable = false)
    private String title;
    
    @Column(columnDefinition = "TEXT", nullable = false)
    private String description;
    
    @Column(precision = 15, scale = 2, nullable = false)
    private BigDecimal amount;
    
    @Column(length = 3)
    private String currency = "USD";
    
    @Column(name = "department_id", nullable = false)
    private UUID departmentId;
    
    @Column(name = "requester_id", nullable = false)
    private UUID requesterId;
    
    @Enumerated(EnumType.STRING)
    @Column(length = 30)
    private RequestStatus status = RequestStatus.DRAFT;
    
    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private Priority priority = Priority.MEDIUM;
    
    @Column(name = "target_delivery_date")
    private LocalDate targetDeliveryDate;
    
    @Column(name = "budget_reserved")
    private Boolean budgetReserved = false;
    
    @Column(name = "submitted_at")
    private LocalDateTime submittedAt;
    
    @OneToMany(mappedBy = "request", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<RequestItem> items = new ArrayList<>();
    
    @OneToMany(mappedBy = "request", cascade = CascadeType.ALL)
    private List<ApprovalRecord> approvals = new ArrayList<>();
}

// com.procurement.requisition.entity.RequestStatus.java
package com.procurement.requisition.entity;

public enum RequestStatus {
    DRAFT,
    PENDING_APPROVAL,
    APPROVED,
    REJECTED,
    ORDERED,
    COMPLETED,
    CANCELLED
}

// com.procurement.requisition.entity.Priority.java
package com.procurement.requisition.entity;

public enum Priority {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL
}

// com.procurement.requisition.entity.RequestItem.java
package com.procurement.requisition.entity;

import com.procurement.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Entity
@Table(name = "request_items")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RequestItem extends BaseEntity {
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "request_id", nullable = false)
    private PurchaseRequest request;
    
    @Column(name = "item_name", nullable = false)
    private String itemName;
    
    @Column(columnDefinition = "TEXT")
    private String description;
    
    @Column(nullable = false)
    private Integer quantity;
    
    @Column(name = "unit_price", precision = 15, scale = 2, nullable = false)
    private BigDecimal unitPrice;
    
    @Column(name = "total_price", precision = 15, scale = 2, nullable = false)
    private BigDecimal totalPrice;
    
    @Column(length = 100)
    private String category;
    
    @Column(columnDefinition = "TEXT")
    private String specifications;
}

// com.procurement.requisition.entity.ApprovalRecord.java
package com.procurement.requisition.entity;

import com.procurement.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "approval_records")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ApprovalRecord extends BaseEntity {
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "request_id", nullable = false)
    private PurchaseRequest request;
    
    @Column(name = "approver_id", nullable = false)
    private UUID approverId;
    
    @Column(nullable = false)
    private Integer level;
    
    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private ApprovalStatus status = ApprovalStatus.PENDING;
    
    @Column(columnDefinition = "TEXT")
    private String comments;
    
    @Column(name = "approved_at")
    private LocalDateTime approvedAt;
}

// com.procurement.requisition.entity.ApprovalStatus.java
package com.procurement.requisition.entity;

public enum ApprovalStatus {
    PENDING,
    APPROVED,
    REJECTED
}
```

### 4. Order & Payment Service Types

```java
// com.procurement.order.entity.PurchaseOrder.java
package com.procurement.order.entity;

import com.procurement.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "purchase_orders")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PurchaseOrder extends BaseEntity {
    
    @Column(name = "po_number", length = 50, unique = true, nullable = false)
    private String poNumber;
    
    @Column(name = "purchase_request_id", nullable = false)
    private UUID purchaseRequestId;
    
    @Column(name = "vendor_id", nullable = false)
    private UUID vendorId;
    
    @Column(name = "quotation_id")
    private UUID quotationId;
    
    @Column(name = "total_amount", precision = 15, scale = 2, nullable = false)
    private BigDecimal totalAmount;
    
    @Column(length = 3)
    private String currency = "USD";
    
    @Enumerated(EnumType.STRING)
    @Column(length = 30)
    private OrderStatus status = OrderStatus.PENDING;
    
    @Column(name = "order_date", nullable = false)
    private LocalDateTime orderDate;
    
    @Column(name = "expected_delivery_date")
    private LocalDate expectedDeliveryDate;
    
    @Column(name = "delivery_address", columnDefinition = "TEXT", nullable = false)
    private String deliveryAddress;
    
    @Column(name = "payment_terms", length = 50)
    private String paymentTerms;
    
    @Column(columnDefinition = "TEXT")
    private String notes;
    
    @Column(name = "created_by", nullable = false)
    private UUID createdBy;
    
    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<OrderItem> items = new ArrayList<>();
}

// com.procurement.order.entity.OrderStatus.java
package com.procurement.order.entity;

public enum OrderStatus {
    PENDING,
    CONFIRMED,
    SHIPPED,
    DELIVERED,
    INVOICED,
    PAID,
    CANCELLED
}

// com.procurement.order.entity.Invoice.java
package com.procurement.order.entity;

import com.procurement.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "invoices")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Invoice extends BaseEntity {
    
    @Column(name = "invoice_number", length = 50, unique = true, nullable = false)
    private String invoiceNumber;
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "order_id", nullable = false)
    private PurchaseOrder order;
    
    @Column(name = "vendor_id", nullable = false)
    private UUID vendorId;
    
    @Column(name = "invoice_amount", precision = 15, scale = 2, nullable = false)
    private BigDecimal invoiceAmount;
    
    @Column(length = 3)
    private String currency = "USD";
    
    @Column(name = "invoice_date", nullable = false)
    private LocalDate invoiceDate;
    
    @Column(name = "due_date", nullable = false)
    private LocalDate dueDate;
    
    @Enumerated(EnumType.STRING)
    @Column(length = 30)
    private InvoiceStatus status = InvoiceStatus.PENDING;
    
    @Column(name = "payment_terms", length = 50)
    private String paymentTerms;
    
    @Column(columnDefinition = "TEXT")
    private String notes;
    
    @Column(name = "uploaded_by", nullable = false)
    private UUID uploadedBy;
}

// com.procurement.order.entity.InvoiceStatus.java
package com.procurement.order.entity;

public enum InvoiceStatus {
    PENDING,
    APPROVED,
    REJECTED,
    PAID,
    OVERDUE
}
```

### 5. DTOs (Data Transfer Objects)

```java
// com.procurement.budget.dto.CreateBudgetDto.java
package com.procurement.budget.dto;

import jakarta.validation.constraints.*;
import lombok.Data;

import java.math.BigDecimal;
import java.util.UUID;

@Data
public class CreateBudgetDto {
    
    @NotNull(message = "Department ID is required")
    private UUID departmentId;
    
    @NotBlank(message = "Fiscal year is required")
    @Pattern(regexp = "\\d{4}", message = "Fiscal year must be 4 digits")
    private String fiscalYear;
    
    @NotNull(message = "Total allocated amount is required")
    @DecimalMin(value = "0.01", message = "Amount must be greater than 0")
    private BigDecimal totalAllocatedAmount;
    
    @Pattern(regexp = "USD|EUR|GBP", message = "Currency must be USD, EUR, or GBP")
    private String currency = "USD";
}

// com.procurement.common.dto.PaginationDto.java
package com.procurement.common.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Max;
import lombok.Data;

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
```

---

## Shared Domain Models

### Event Types

Both NestJS and Spring Boot services publish and consume events:

**TypeScript (NestJS)**:
```typescript
export interface BudgetReservationCreatedEvent {
  eventId: string;
  eventType: 'budget.reservation.created';
  timestamp: Date;
  source: 'budget-service';
  data: {
    reservationId: string;
    budgetId: string;
    requestId: string;
    amount: number;
  };
}
```

**Java (Spring Boot)**:
```java
@Data
@Builder
public class BudgetReservationCreatedEvent {
    private String eventId;
    private String eventType; // "budget.reservation.created"
    private LocalDateTime timestamp;
    private String source; // "budget-service"
    private BudgetReservationEventData data;
}

@Data
public class BudgetReservationEventData {
    private UUID reservationId;
    private UUID budgetId;
    private UUID requestId;
    private BigDecimal amount;
}
```

---

## Summary

✅ **NestJS Services (User, Vendor)**: Use TypeORM with decorators  
✅ **Spring Boot Services (Budget, Requisition, Order & Payment)**: Use JPA with annotations  
✅ **Consistent naming**: snake_case in database, camelCase in code  
✅ **Enums**: Use strongly-typed enums in both languages  
✅ **DTOs**: Validate input with class-validator (NestJS) and Jakarta Bean Validation (Spring Boot)  
✅ **Events**: Consistent event structure across services
