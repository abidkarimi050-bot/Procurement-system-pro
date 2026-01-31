# Database Design Guide

## Overview

The procurement system uses a **Database per Service** approach, where each microservice owns and manages its own database schema. This ensures loose coupling while maintaining data consistency through event-driven synchronization.

### Principles

1. **Immutability for Audit**: Financial transactions are immutable (append-only logs)
2. **Eventual Consistency**: Services synchronize through events, not direct queries
3. **Data Replication**: Read-only copies of other services' data when needed
4. **ACID Compliance**: Financial transactions require strong ACID guarantees
5. **Audit Trail**: Every change is logged with actor, timestamp, and reasoning

---

## 1. User Service Database

### Core Tables

#### departments
```sql
CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20) UNIQUE NOT NULL,
  parent_id UUID REFERENCES departments(id),
  manager_id UUID,
  description TEXT,
  cost_center VARCHAR(50),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by UUID
);

CREATE INDEX idx_dept_active ON departments(is_active);
CREATE INDEX idx_dept_parent ON departments(parent_id);
CREATE INDEX idx_dept_manager ON departments(manager_id);
```

#### users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keycloak_id VARCHAR(100) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  employee_id VARCHAR(50) UNIQUE,
  department_id UUID REFERENCES departments(id),
  job_title VARCHAR(100),
  phone VARCHAR(20),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_keycloak ON users(keycloak_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_dept ON users(department_id);
CREATE INDEX idx_users_active ON users(is_active);

-- Add FK for department manager
ALTER TABLE departments 
  ADD CONSTRAINT fk_dept_manager 
  FOREIGN KEY (manager_id) REFERENCES users(id);
```

#### roles
```sql
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) UNIQUE NOT NULL,
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pre-populate roles
INSERT INTO roles (name, description) VALUES
  ('REQUESTER', 'Can create and view purchase requests'),
  ('MANAGER', 'Can approve level-1 requests'),
  ('FINANCE', 'Can approve level-2 requests and manage budgets'),
  ('ADMIN', 'Full system access');
```

#### user_roles
```sql
CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  assigned_by UUID REFERENCES users(id),
  UNIQUE(user_id, role_id)
);

CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);
```

#### approval_hierarchy
```sql
CREATE TABLE approval_hierarchy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  approver_id UUID REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL CHECK (level > 0),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, approver_id, level)
);

CREATE INDEX idx_approval_hierarchy_user ON approval_hierarchy(user_id);
CREATE INDEX idx_approval_hierarchy_approver ON approval_hierarchy(approver_id);
```

#### spending_limits
```sql
CREATE TABLE spending_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID REFERENCES roles(id),
  user_id UUID REFERENCES users(id),
  max_amount DECIMAL(15, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  requires_next_level BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (role_id IS NOT NULL OR user_id IS NOT NULL)
);

CREATE INDEX idx_spending_limits_role ON spending_limits(role_id);
CREATE INDEX idx_spending_limits_user ON spending_limits(user_id);
```

---

## 2. Budget Service Database

### Core Tables

#### budgets
```sql
CREATE TABLE budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL,
  fiscal_year VARCHAR(4) NOT NULL,
  total_allocated_amount DECIMAL(15, 2) NOT NULL CHECK (total_allocated_amount > 0),
  spent_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
  reserved_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'USD',
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'closed', 'suspended')),
  allocated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  allocated_by UUID NOT NULL,
  closed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(department_id, fiscal_year)
);

-- Calculated field formula:
-- available_amount = total_allocated_amount - spent_amount - reserved_amount

CREATE INDEX idx_budget_dept ON budgets(department_id);
CREATE INDEX idx_budget_fiscal_year ON budgets(fiscal_year);
CREATE INDEX idx_budget_status ON budgets(status);

-- Add check constraint
ALTER TABLE budgets ADD CONSTRAINT check_budget_amounts
  CHECK (spent_amount + reserved_amount <= total_allocated_amount);
```

#### budget_reservations
```sql
CREATE TABLE budget_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID NOT NULL REFERENCES budgets(id),
  purchase_request_id UUID NOT NULL UNIQUE,
  order_id UUID,
  amount_reserved DECIMAL(15, 2) NOT NULL,
  status VARCHAR(20) DEFAULT 'reserved' 
    CHECK (status IN ('reserved', 'confirmed', 'partially_spent', 'spent', 'released', 'cancelled')),
  expiry_date TIMESTAMP,
  released_at TIMESTAMP,
  spent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reservation_budget ON budget_reservations(budget_id);
CREATE INDEX idx_reservation_request ON budget_reservations(purchase_request_id);
CREATE INDEX idx_reservation_status ON budget_reservations(status);
CREATE INDEX idx_reservation_expiry ON budget_reservations(expiry_date);
```

#### budget_topup_requests
```sql
CREATE TABLE budget_topup_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL,
  fiscal_year VARCHAR(4) NOT NULL,
  requested_amount DECIMAL(15, 2) NOT NULL CHECK (requested_amount > 0),
  justification TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' 
    CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by UUID NOT NULL,
  reviewed_by UUID,
  reviewed_at TIMESTAMP,
  review_comments TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_topup_dept ON budget_topup_requests(department_id);
CREATE INDEX idx_topup_status ON budget_topup_requests(status);
CREATE INDEX idx_topup_requester ON budget_topup_requests(requested_by);
```

#### budget_transactions (Audit Log)
```sql
CREATE TABLE budget_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID NOT NULL REFERENCES budgets(id),
  reservation_id UUID REFERENCES budget_reservations(id),
  transaction_type VARCHAR(20) NOT NULL 
    CHECK (transaction_type IN ('allocate', 'reserve', 'release', 'consume', 'topup', 'adjust')),
  amount DECIMAL(15, 2) NOT NULL,
  balance_before DECIMAL(15, 2) NOT NULL,
  balance_after DECIMAL(15, 2) NOT NULL,
  description TEXT,
  performed_by UUID NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_budget_txn_budget ON budget_transactions(budget_id);
CREATE INDEX idx_budget_txn_type ON budget_transactions(transaction_type);
CREATE INDEX idx_budget_txn_date ON budget_transactions(created_at);
```

#### departments_replica (Read-only)
```sql
-- Synchronized from User Service via Kafka events
CREATE TABLE departments_replica (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_dept_replica_active ON departments_replica(is_active);
```

---

## 3. Requisition Service Database

### Core Tables

#### purchase_requests
```sql
CREATE TABLE purchase_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  amount DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) DEFAULT 'USD',
  department_id UUID NOT NULL,
  requester_id UUID NOT NULL,
  status VARCHAR(30) DEFAULT 'draft' 
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'ordered', 'completed', 'cancelled')),
  priority VARCHAR(20) DEFAULT 'medium' 
    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  target_delivery_date DATE,
  budget_reserved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  submitted_at TIMESTAMP
);

CREATE INDEX idx_request_dept ON purchase_requests(department_id);
CREATE INDEX idx_request_requester ON purchase_requests(requester_id);
CREATE INDEX idx_request_status ON purchase_requests(status);
CREATE INDEX idx_request_priority ON purchase_requests(priority);
CREATE INDEX idx_request_created ON purchase_requests(created_at);
```

#### request_items
```sql
CREATE TABLE request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  item_name VARCHAR(255) NOT NULL,
  description TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(15, 2) NOT NULL CHECK (unit_price > 0),
  total_price DECIMAL(15, 2) NOT NULL,
  category VARCHAR(100),
  specifications TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_request_items_request ON request_items(request_id);
```

#### approval_records
```sql
CREATE TABLE approval_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  approver_id UUID NOT NULL,
  level INTEGER NOT NULL CHECK (level > 0),
  status VARCHAR(20) DEFAULT 'pending' 
    CHECK (status IN ('pending', 'approved', 'rejected')),
  comments TEXT,
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(request_id, level)
);

CREATE INDEX idx_approval_request ON approval_records(request_id);
CREATE INDEX idx_approval_approver ON approval_records(approver_id);
CREATE INDEX idx_approval_status ON approval_records(status);
```

#### approval_workflow_config
```sql
CREATE TABLE approval_workflow_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  min_amount DECIMAL(15, 2) NOT NULL,
  max_amount DECIMAL(15, 2),
  required_approval_levels INTEGER NOT NULL CHECK (required_approval_levels > 0),
  description VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (max_amount IS NULL OR max_amount > min_amount)
);

-- Example workflows:
-- $0 - $5,000: 1 level (Manager)
-- $5,001 - $50,000: 2 levels (Manager + Finance)
-- $50,001+: 3 levels (Manager + Finance + Executive)
```

#### users_replica (Read-only)
```sql
-- Synchronized from User Service via Kafka events
CREATE TABLE users_replica (
  id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  department_id UUID,
  is_active BOOLEAN DEFAULT TRUE,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_replica_dept ON users_replica(department_id);
```

#### departments_replica (Read-only)
```sql
CREATE TABLE departments_replica (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 4. Vendor Service Database

### Core Tables

#### vendors
```sql
CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  website VARCHAR(255),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(50),
  zip_code VARCHAR(20),
  country VARCHAR(100) DEFAULT 'USA',
  tax_id VARCHAR(50),
  category VARCHAR(50) 
    CHECK (category IN ('office-supplies', 'equipment', 'services', 'consulting', 'software', 'other')),
  status VARCHAR(20) DEFAULT 'active' 
    CHECK (status IN ('active', 'inactive', 'blocked')),
  rating DECIMAL(3, 2) CHECK (rating >= 1 AND rating <= 5),
  bank_name VARCHAR(255),
  bank_account VARCHAR(50),
  payment_terms VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID NOT NULL
);

CREATE INDEX idx_vendors_name ON vendors(name);
CREATE INDEX idx_vendors_status ON vendors(status);
CREATE INDEX idx_vendors_category ON vendors(category);
CREATE INDEX idx_vendors_rating ON vendors(rating);
```

#### rfq_requests
```sql
CREATE TABLE rfq_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id UUID NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  deadline TIMESTAMP NOT NULL,
  status VARCHAR(20) DEFAULT 'draft' 
    CHECK (status IN ('draft', 'published', 'closed', 'cancelled')),
  created_by UUID NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP,
  closed_at TIMESTAMP
);

CREATE INDEX idx_rfq_request ON rfq_requests(purchase_request_id);
CREATE INDEX idx_rfq_status ON rfq_requests(status);
CREATE INDEX idx_rfq_deadline ON rfq_requests(deadline);
```

#### rfq_vendors
```sql
CREATE TABLE rfq_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES rfq_requests(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notified BOOLEAN DEFAULT FALSE,
  UNIQUE(rfq_id, vendor_id)
);

CREATE INDEX idx_rfq_vendors_rfq ON rfq_vendors(rfq_id);
CREATE INDEX idx_rfq_vendors_vendor ON rfq_vendors(vendor_id);
```

#### quotations
```sql
CREATE TABLE quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES rfq_requests(id),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  total_amount DECIMAL(15, 2) NOT NULL CHECK (total_amount > 0),
  currency VARCHAR(3) DEFAULT 'USD',
  valid_until DATE NOT NULL,
  notes TEXT,
  status VARCHAR(20) DEFAULT 'pending' 
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP,
  reviewed_by UUID,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(rfq_id, vendor_id)
);

CREATE INDEX idx_quotation_rfq ON quotations(rfq_id);
CREATE INDEX idx_quotation_vendor ON quotations(vendor_id);
CREATE INDEX idx_quotation_status ON quotations(status);
```

#### quotation_line_items
```sql
CREATE TABLE quotation_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  item_name VARCHAR(255) NOT NULL,
  description TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(15, 2) NOT NULL CHECK (unit_price > 0),
  total_price DECIMAL(15, 2) NOT NULL,
  delivery_time VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_quotation_items_quotation ON quotation_line_items(quotation_id);
```

#### vendor_ratings
```sql
CREATE TABLE vendor_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  order_id UUID NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review TEXT,
  rated_by UUID NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(vendor_id, order_id)
);

CREATE INDEX idx_rating_vendor ON vendor_ratings(vendor_id);
CREATE INDEX idx_rating_order ON vendor_ratings(order_id);
```

---

## 5. Order & Payment Service Database

### Core Tables

#### purchase_orders
```sql
CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number VARCHAR(50) UNIQUE NOT NULL,
  purchase_request_id UUID NOT NULL,
  vendor_id UUID NOT NULL,
  quotation_id UUID,
  total_amount DECIMAL(15, 2) NOT NULL CHECK (total_amount > 0),
  currency VARCHAR(3) DEFAULT 'USD',
  status VARCHAR(30) DEFAULT 'pending' 
    CHECK (status IN ('pending', 'confirmed', 'shipped', 'delivered', 'invoiced', 'paid', 'cancelled')),
  order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expected_delivery_date DATE,
  delivery_address TEXT NOT NULL,
  payment_terms VARCHAR(50),
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_po_request ON purchase_orders(purchase_request_id);
CREATE INDEX idx_po_vendor ON purchase_orders(vendor_id);
CREATE INDEX idx_po_status ON purchase_orders(status);
CREATE INDEX idx_po_number ON purchase_orders(po_number);
CREATE INDEX idx_po_order_date ON purchase_orders(order_date);
```

#### order_items
```sql
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_name VARCHAR(255) NOT NULL,
  description TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(15, 2) NOT NULL CHECK (unit_price > 0),
  total_price DECIMAL(15, 2) NOT NULL,
  received_quantity INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
```

#### goods_receipts
```sql
CREATE TABLE goods_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES purchase_orders(id),
  gr_number VARCHAR(50) UNIQUE NOT NULL,
  received_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  received_by UUID NOT NULL,
  notes TEXT,
  status VARCHAR(20) DEFAULT 'pending' 
    CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by UUID,
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_gr_order ON goods_receipts(order_id);
CREATE INDEX idx_gr_number ON goods_receipts(gr_number);
CREATE INDEX idx_gr_status ON goods_receipts(status);
```

#### gr_items
```sql
CREATE TABLE gr_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gr_id UUID NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES order_items(id),
  quantity_received INTEGER NOT NULL CHECK (quantity_received > 0),
  condition VARCHAR(20) DEFAULT 'good' 
    CHECK (condition IN ('good', 'damaged', 'incomplete')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_gr_items_gr ON gr_items(gr_id);
CREATE INDEX idx_gr_items_order_item ON gr_items(order_item_id);
```

#### invoices
```sql
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  order_id UUID NOT NULL REFERENCES purchase_orders(id),
  vendor_id UUID NOT NULL,
  invoice_amount DECIMAL(15, 2) NOT NULL CHECK (invoice_amount > 0),
  currency VARCHAR(3) DEFAULT 'USD',
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(30) DEFAULT 'pending' 
    CHECK (status IN ('pending', 'approved', 'rejected', 'paid', 'overdue')),
  payment_terms VARCHAR(50),
  notes TEXT,
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_invoice_order ON invoices(order_id);
CREATE INDEX idx_invoice_vendor ON invoices(vendor_id);
CREATE INDEX idx_invoice_status ON invoices(status);
CREATE INDEX idx_invoice_number ON invoices(invoice_number);
CREATE INDEX idx_invoice_due_date ON invoices(due_date);
```

#### three_way_match
```sql
CREATE TABLE three_way_match (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES purchase_orders(id),
  gr_id UUID NOT NULL REFERENCES goods_receipts(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  po_amount DECIMAL(15, 2) NOT NULL,
  gr_amount DECIMAL(15, 2) NOT NULL,
  invoice_amount DECIMAL(15, 2) NOT NULL,
  match_status VARCHAR(20) NOT NULL 
    CHECK (match_status IN ('matched', 'mismatched')),
  variance_amount DECIMAL(15, 2) DEFAULT 0,
  notes TEXT,
  matched_by UUID NOT NULL,
  matched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id, gr_id, invoice_id)
);

CREATE INDEX idx_match_order ON three_way_match(order_id);
CREATE INDEX idx_match_status ON three_way_match(match_status);
```

#### payments
```sql
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number VARCHAR(50) UNIQUE NOT NULL,
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  amount_paid DECIMAL(15, 2) NOT NULL CHECK (amount_paid > 0),
  currency VARCHAR(3) DEFAULT 'USD',
  payment_date DATE NOT NULL,
  payment_method VARCHAR(50),
  reference_number VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending' 
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  processed_by UUID NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_payment_invoice ON payments(invoice_id);
CREATE INDEX idx_payment_status ON payments(status);
CREATE INDEX idx_payment_date ON payments(payment_date);
```

#### vendors_replica (Read-only)
```sql
-- Synchronized from Vendor Service via Kafka events
CREATE TABLE vendors_replica (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 6. Data Synchronization Patterns

### Event-Driven Replication

Services maintain read-only replicas of data from other services:

| Service | Replicated Data | Source Service |
|---------|----------------|----------------|
| Budget | Departments | User Service |
| Requisition | Users, Departments | User Service |
| Order & Payment | Vendors | Vendor Service |

### Sync Flow Example

```
User Service creates department
    ↓
Publish event: "user.department.created"
    ↓
Budget Service & Requisition Service consume event
    ↓
Update departments_replica table
```

### Handling Sync Failures

```sql
-- Sync status tracking
CREATE TABLE sync_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  last_synced_at TIMESTAMP,
  sync_status VARCHAR(20) CHECK (sync_status IN ('synced', 'pending', 'failed')),
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type, entity_id)
);
```

---

## 7. Migration Strategy

### Tools
- **NestJS**: TypeORM migrations
- **Spring Boot**: Flyway or Liquibase

### Naming Convention
```
V{version}__{description}.sql
V001__create_users_tables.sql
V002__add_approval_hierarchy.sql
V003__create_budgets_tables.sql
```

### Example Migration (Flyway)

```sql
-- V001__create_users_tables.sql
-- User Service initial schema

CREATE TABLE IF NOT EXISTS departments (
  -- schema here
);

CREATE TABLE IF NOT EXISTS users (
  -- schema here
);

-- Add indexes
CREATE INDEX idx_users_dept ON users(department_id);
```

---

## Summary

✅ 5 separate databases (one per service)  
✅ Event-driven data synchronization via Kafka  
✅ Read-only replicas for cross-service queries  
✅ Immutable audit logs for financial transactions  
✅ Proper indexes for query performance  
✅ Foreign key constraints within service boundaries  
✅ Check constraints for data integrity  
✅ Migration-based schema management
