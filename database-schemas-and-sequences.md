# Procurement System - Database Schemas & Sequence Diagrams

---

## 1. Database Schemas

### 1.1 User Service Database (PostgreSQL)

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- USER SERVICE SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════

-- Departments table
CREATE TABLE departments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,
    code            VARCHAR(20) UNIQUE NOT NULL,      -- e.g., 'IT', 'FIN', 'HR'
    parent_id       UUID REFERENCES departments(id),   -- For org hierarchy
    manager_id      UUID,                              -- Department manager
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users table
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keycloak_id     VARCHAR(100) UNIQUE NOT NULL,     -- Synced with Keycloak
    email           VARCHAR(255) UNIQUE NOT NULL,
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100) NOT NULL,
    employee_id     VARCHAR(50) UNIQUE,
    department_id   UUID REFERENCES departments(id),
    job_title       VARCHAR(100),
    phone           VARCHAR(20),
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add FK for department manager
ALTER TABLE departments 
    ADD CONSTRAINT fk_dept_manager 
    FOREIGN KEY (manager_id) REFERENCES users(id);

-- Roles table (mirrors Keycloak roles)
CREATE TABLE roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(50) UNIQUE NOT NULL,      -- REQUESTER, MANAGER, FINANCE, etc.
    description     VARCHAR(255),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User-Role assignments
CREATE TABLE user_roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id         UUID REFERENCES roles(id) ON DELETE CASCADE,
    assigned_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_by     UUID REFERENCES users(id),
    UNIQUE(user_id, role_id)
);

-- Approval hierarchy (who approves whom)
CREATE TABLE approval_hierarchy (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    approver_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    level           INTEGER NOT NULL,                  -- 1 = direct, 2 = skip-level
    is_active       BOOLEAN DEFAULT TRUE,
    UNIQUE(user_id, approver_id)
);

-- Spending limits per role/user
CREATE TABLE spending_limits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id         UUID REFERENCES roles(id),
    user_id         UUID REFERENCES users(id),         -- Optional: user-specific override
    max_amount      DECIMAL(15,2) NOT NULL,
    currency        VARCHAR(3) DEFAULT 'USD',
    requires_next_level BOOLEAN DEFAULT TRUE,          -- Escalate if exceeded
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CHECK (role_id IS NOT NULL OR user_id IS NOT NULL)
);

-- Indexes
CREATE INDEX idx_users_department ON users(department_id);
CREATE INDEX idx_users_keycloak ON users(keycloak_id);
CREATE INDEX idx_approval_hierarchy_user ON approval_hierarchy(user_id);
```

---

### 1.2 Budget Service Database (PostgreSQL)

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- BUDGET SERVICE SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════

-- Department budgets
CREATE TABLE department_budgets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id   UUID NOT NULL,                     -- From User Service
    fiscal_year     INTEGER NOT NULL,
    total_amount    DECIMAL(15,2) NOT NULL,
    spent_amount    DECIMAL(15,2) DEFAULT 0,
    reserved_amount DECIMAL(15,2) DEFAULT 0,           -- Pending orders
    currency        VARCHAR(3) DEFAULT 'USD',
    status          VARCHAR(20) DEFAULT 'ACTIVE',      -- ACTIVE, FROZEN, CLOSED
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(department_id, fiscal_year)
);

-- Available = total_amount - spent_amount - reserved_amount

-- Budget allocations (quarterly/monthly breakdown)
CREATE TABLE budget_allocations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id       UUID REFERENCES department_budgets(id),
    period_type     VARCHAR(20) NOT NULL,              -- MONTHLY, QUARTERLY
    period_number   INTEGER NOT NULL,                  -- 1-12 or 1-4
    allocated_amount DECIMAL(15,2) NOT NULL,
    spent_amount    DECIMAL(15,2) DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Budget transactions (all changes tracked)
CREATE TABLE budget_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id       UUID REFERENCES department_budgets(id),
    transaction_type VARCHAR(30) NOT NULL,             -- RESERVE, SPEND, RELEASE, TOP_UP
    amount          DECIMAL(15,2) NOT NULL,
    reference_type  VARCHAR(50),                       -- PURCHASE_ORDER, TOP_UP_REQUEST
    reference_id    UUID,                              -- ID of related entity
    description     VARCHAR(500),
    created_by      UUID NOT NULL,                     -- User ID
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Top-up requests
CREATE TABLE top_up_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id       UUID REFERENCES department_budgets(id),
    requested_amount DECIMAL(15,2) NOT NULL,
    justification   TEXT NOT NULL,
    status          VARCHAR(20) DEFAULT 'PENDING',     -- PENDING, APPROVED, REJECTED
    requested_by    UUID NOT NULL,
    approved_by     UUID,
    approved_at     TIMESTAMP,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_budget_dept_year ON department_budgets(department_id, fiscal_year);
CREATE INDEX idx_budget_transactions_ref ON budget_transactions(reference_type, reference_id);
```

---

### 1.3 Requisition Service Database (PostgreSQL)

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- REQUISITION SERVICE SCHEMA (Purchase Requests + Approvals)
-- ═══════════════════════════════════════════════════════════════════════════

-- Purchase requests
CREATE TABLE purchase_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_number  VARCHAR(50) UNIQUE NOT NULL,       -- Auto-generated: PR-2026-00001
    title           VARCHAR(255) NOT NULL,
    description     TEXT,
    department_id   UUID NOT NULL,
    requester_id    UUID NOT NULL,
    total_amount    DECIMAL(15,2) NOT NULL,
    currency        VARCHAR(3) DEFAULT 'USD',
    priority        VARCHAR(20) DEFAULT 'NORMAL',      -- LOW, NORMAL, HIGH, URGENT
    required_date   DATE,
    status          VARCHAR(30) DEFAULT 'DRAFT',       -- See status enum below
    current_step    INTEGER DEFAULT 1,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    submitted_at    TIMESTAMP
);

-- Status: DRAFT → PENDING_APPROVAL → APPROVED → RFQ_SENT → VENDOR_SELECTED 
--         → PO_CREATED → COMPLETED | REJECTED | CANCELLED

-- Request line items
CREATE TABLE request_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID REFERENCES purchase_requests(id) ON DELETE CASCADE,
    item_number     INTEGER NOT NULL,
    description     VARCHAR(500) NOT NULL,
    category        VARCHAR(100),                      -- IT Equipment, Office Supplies, etc.
    quantity        DECIMAL(10,2) NOT NULL,
    unit            VARCHAR(20),                       -- EACH, BOX, KG, etc.
    estimated_price DECIMAL(15,2) NOT NULL,
    specifications  TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Approval workflow steps (per request)
CREATE TABLE approval_steps (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID REFERENCES purchase_requests(id) ON DELETE CASCADE,
    step_number     INTEGER NOT NULL,
    approver_id     UUID NOT NULL,
    approver_role   VARCHAR(50),                       -- MANAGER, DEPT_HEAD, FINANCE
    status          VARCHAR(20) DEFAULT 'PENDING',     -- PENDING, APPROVED, REJECTED, SKIPPED
    comments        TEXT,
    acted_at        TIMESTAMP,
    due_date        TIMESTAMP,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(request_id, step_number)
);

-- Approval history (audit trail)
CREATE TABLE approval_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID REFERENCES purchase_requests(id),
    step_id         UUID REFERENCES approval_steps(id),
    action          VARCHAR(30) NOT NULL,              -- SUBMITTED, APPROVED, REJECTED, RETURNED
    actor_id        UUID NOT NULL,
    comments        TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Attachments
CREATE TABLE attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID REFERENCES purchase_requests(id) ON DELETE CASCADE,
    file_name       VARCHAR(255) NOT NULL,
    file_type       VARCHAR(100),
    file_size       INTEGER,
    storage_path    VARCHAR(500) NOT NULL,             -- S3/MinIO path
    uploaded_by     UUID NOT NULL,
    uploaded_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_requests_status ON purchase_requests(status);
CREATE INDEX idx_requests_requester ON purchase_requests(requester_id);
CREATE INDEX idx_requests_department ON purchase_requests(department_id);
CREATE INDEX idx_approval_steps_approver ON approval_steps(approver_id, status);
```

---

### 1.4 Vendor Service Database (PostgreSQL)

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- VENDOR SERVICE SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════

-- Vendors
CREATE TABLE vendors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_code     VARCHAR(50) UNIQUE NOT NULL,       -- VEN-00001
    company_name    VARCHAR(255) NOT NULL,
    contact_name    VARCHAR(100),
    email           VARCHAR(255) NOT NULL,
    phone           VARCHAR(20),
    address         TEXT,
    city            VARCHAR(100),
    country         VARCHAR(100),
    tax_id          VARCHAR(50),
    payment_terms   VARCHAR(50),                       -- NET30, NET60, etc.
    categories      VARCHAR(500),                      -- IT, Office, etc. (comma-separated)
    status          VARCHAR(20) DEFAULT 'ACTIVE',      -- ACTIVE, INACTIVE, BLACKLISTED
    rating          DECIMAL(3,2),                      -- 0.00 to 5.00
    keycloak_id     VARCHAR(100),                      -- For vendor portal login
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- RFQ (Request for Quotation)
CREATE TABLE rfq_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfq_number      VARCHAR(50) UNIQUE NOT NULL,       -- RFQ-2026-00001
    purchase_request_id UUID NOT NULL,                 -- From Requisition Service
    title           VARCHAR(255) NOT NULL,
    description     TEXT,
    submission_deadline TIMESTAMP NOT NULL,
    status          VARCHAR(20) DEFAULT 'OPEN',        -- OPEN, CLOSED, CANCELLED
    created_by      UUID NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- RFQ sent to vendors
CREATE TABLE rfq_vendors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfq_id          UUID REFERENCES rfq_requests(id) ON DELETE CASCADE,
    vendor_id       UUID REFERENCES vendors(id),
    sent_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    viewed_at       TIMESTAMP,
    responded       BOOLEAN DEFAULT FALSE
);

-- Quotations (vendor responses)
CREATE TABLE quotations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quotation_number VARCHAR(50) UNIQUE NOT NULL,
    rfq_id          UUID REFERENCES rfq_requests(id),
    vendor_id       UUID REFERENCES vendors(id),
    total_amount    DECIMAL(15,2) NOT NULL,
    currency        VARCHAR(3) DEFAULT 'USD',
    valid_until     DATE,
    delivery_days   INTEGER,
    payment_terms   VARCHAR(50),
    notes           TEXT,
    status          VARCHAR(20) DEFAULT 'SUBMITTED',   -- SUBMITTED, SELECTED, REJECTED
    is_selected     BOOLEAN DEFAULT FALSE,
    selection_reason TEXT,                             -- Required if not cheapest
    submitted_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Quotation line items
CREATE TABLE quotation_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quotation_id    UUID REFERENCES quotations(id) ON DELETE CASCADE,
    request_item_id UUID,                              -- Maps to request_items
    description     VARCHAR(500),
    quantity        DECIMAL(10,2) NOT NULL,
    unit_price      DECIMAL(15,2) NOT NULL,
    total_price     DECIMAL(15,2) NOT NULL
);

-- Vendor ratings
CREATE TABLE vendor_ratings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id       UUID REFERENCES vendors(id),
    order_id        UUID,                              -- From Order Service
    quality_score   INTEGER CHECK (quality_score BETWEEN 1 AND 5),
    delivery_score  INTEGER CHECK (delivery_score BETWEEN 1 AND 5),
    price_score     INTEGER CHECK (price_score BETWEEN 1 AND 5),
    overall_score   DECIMAL(3,2),
    comments        TEXT,
    rated_by        UUID NOT NULL,
    rated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_vendors_status ON vendors(status);
CREATE INDEX idx_rfq_purchase_request ON rfq_requests(purchase_request_id);
CREATE INDEX idx_quotations_rfq ON quotations(rfq_id);
```

---

### 1.5 Order & Payment Service Database (PostgreSQL)

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ORDER & PAYMENT SERVICE SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════

-- Purchase Orders
CREATE TABLE purchase_orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number       VARCHAR(50) UNIQUE NOT NULL,       -- PO-2026-00001
    purchase_request_id UUID NOT NULL,                 -- From Requisition Service
    quotation_id    UUID NOT NULL,                     -- Selected quotation
    vendor_id       UUID NOT NULL,
    department_id   UUID NOT NULL,
    total_amount    DECIMAL(15,2) NOT NULL,
    currency        VARCHAR(3) DEFAULT 'USD',
    status          VARCHAR(30) DEFAULT 'PENDING',     -- See status below
    payment_terms   VARCHAR(50),
    delivery_address TEXT,
    expected_delivery DATE,
    created_by      UUID NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Status: PENDING → SENT → ACKNOWLEDGED → PARTIALLY_RECEIVED → RECEIVED → INVOICED → PAID

-- PO line items
CREATE TABLE order_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    item_number     INTEGER NOT NULL,
    description     VARCHAR(500) NOT NULL,
    quantity        DECIMAL(10,2) NOT NULL,
    unit_price      DECIMAL(15,2) NOT NULL,
    total_price     DECIMAL(15,2) NOT NULL,
    received_qty    DECIMAL(10,2) DEFAULT 0
);

-- Budget reservations
CREATE TABLE budget_reservations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID REFERENCES purchase_orders(id),
    budget_id       UUID NOT NULL,                     -- From Budget Service
    reserved_amount DECIMAL(15,2) NOT NULL,
    status          VARCHAR(20) DEFAULT 'ACTIVE',      -- ACTIVE, RELEASED, CONVERTED
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Goods receipts
CREATE TABLE goods_receipts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_number  VARCHAR(50) UNIQUE NOT NULL,       -- GR-2026-00001
    order_id        UUID REFERENCES purchase_orders(id),
    received_date   DATE NOT NULL,
    received_by     UUID NOT NULL,
    notes           TEXT,
    status          VARCHAR(20) DEFAULT 'PENDING',     -- PENDING, CONFIRMED, DISPUTED
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Receipt line items
CREATE TABLE receipt_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id      UUID REFERENCES goods_receipts(id) ON DELETE CASCADE,
    order_item_id   UUID REFERENCES order_items(id),
    received_qty    DECIMAL(10,2) NOT NULL,
    condition       VARCHAR(20) DEFAULT 'GOOD',        -- GOOD, DAMAGED, REJECTED
    notes           TEXT
);

-- Invoices
CREATE TABLE invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number  VARCHAR(100) NOT NULL,             -- Vendor's invoice number
    order_id        UUID REFERENCES purchase_orders(id),
    vendor_id       UUID NOT NULL,
    invoice_date    DATE NOT NULL,
    due_date        DATE NOT NULL,
    total_amount    DECIMAL(15,2) NOT NULL,
    currency        VARCHAR(3) DEFAULT 'USD',
    status          VARCHAR(20) DEFAULT 'PENDING',     -- PENDING, MATCHED, DISPUTED, PAID
    matching_status VARCHAR(20),                       -- MATCHED, PARTIAL, MISMATCH
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vendor_id, invoice_number)
);

-- 3-Way matching results
CREATE TABLE invoice_matching (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id      UUID REFERENCES invoices(id),
    order_id        UUID REFERENCES purchase_orders(id),
    receipt_id      UUID REFERENCES goods_receipts(id),
    po_amount       DECIMAL(15,2),
    receipt_amount  DECIMAL(15,2),                     -- Based on received qty
    invoice_amount  DECIMAL(15,2),
    variance        DECIMAL(15,2),
    variance_pct    DECIMAL(5,2),
    match_result    VARCHAR(20),                       -- MATCHED, WITHIN_TOLERANCE, MISMATCH
    tolerance_pct   DECIMAL(5,2) DEFAULT 5.00,         -- Acceptable variance
    matched_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    matched_by      UUID
);

-- Payments
CREATE TABLE payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_number  VARCHAR(50) UNIQUE NOT NULL,       -- PAY-2026-00001
    invoice_id      UUID REFERENCES invoices(id),
    amount          DECIMAL(15,2) NOT NULL,
    currency        VARCHAR(3) DEFAULT 'USD',
    payment_method  VARCHAR(30),                       -- BANK_TRANSFER, CHECK, etc.
    payment_date    DATE,
    reference       VARCHAR(100),                      -- Bank reference
    status          VARCHAR(20) DEFAULT 'PENDING',     -- PENDING, APPROVED, PROCESSED, FAILED
    approved_by     UUID,
    approved_at     TIMESTAMP,
    processed_at    TIMESTAMP,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_orders_status ON purchase_orders(status);
CREATE INDEX idx_orders_vendor ON purchase_orders(vendor_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_payments_status ON payments(status);
```

---

## 2. Entity Relationship Diagram (Simplified)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ENTITY RELATIONSHIPS                                      │
└─────────────────────────────────────────────────────────────────────────────┘

USER SERVICE                          BUDGET SERVICE
┌─────────────┐                       ┌──────────────────┐
│ departments │◄──────────────────────│department_budgets│
├─────────────┤         1:N           ├──────────────────┤
│ id          │                       │ department_id    │
│ name        │                       │ total_amount     │
│ manager_id  │───┐                   │ spent_amount     │
└─────────────┘   │                   │ reserved_amount  │
       │          │                   └──────────────────┘
       │ 1:N      │                            │
       ▼          │                            │ 1:N
┌─────────────┐   │                   ┌──────────────────┐
│   users     │◄──┘                   │budget_transactions│
├─────────────┤                       └──────────────────┘
│ id          │
│ department  │
│ keycloak_id │
└─────────────┘
       │
       │ 1:N
       ▼
┌─────────────┐
│ user_roles  │
└─────────────┘


REQUISITION SERVICE
┌──────────────────┐
│purchase_requests │
├──────────────────┤         1:N      ┌───────────────┐
│ id               │─────────────────►│ request_items │
│ request_number   │                  └───────────────┘
│ requester_id     │
│ department_id    │         1:N      ┌───────────────┐
│ status           │─────────────────►│approval_steps │
│ total_amount     │                  └───────────────┘
└──────────────────┘


VENDOR SERVICE
┌──────────────────┐
│   rfq_requests   │
├──────────────────┤         N:M      ┌───────────────┐
│ id               │◄────────────────►│    vendors    │
│purchase_request_id                  └───────────────┘
└──────────────────┘                         │
       │                                     │
       │ 1:N                                 │ 1:N
       ▼                                     ▼
┌──────────────────┐                  ┌───────────────┐
│   quotations     │◄─────────────────│vendor_ratings │
└──────────────────┘                  └───────────────┘


ORDER & PAYMENT SERVICE
┌──────────────────┐
│ purchase_orders  │
├──────────────────┤
│ id               │
│purchase_request_id                  ┌───────────────┐
│ quotation_id     │─────────────────►│ order_items   │
│ vendor_id        │                  └───────────────┘
│ status           │
└──────────────────┘
       │
       │ 1:1                1:N
       ▼                     │
┌──────────────────┐         │        ┌───────────────┐
│ goods_receipts   │─────────┴───────►│ receipt_items │
└──────────────────┘                  └───────────────┘
       │
       │ 1:1
       ▼
┌──────────────────┐         1:1      ┌───────────────┐
│    invoices      │─────────────────►│invoice_matching│
└──────────────────┘                  └───────────────┘
       │
       │ 1:1
       ▼
┌──────────────────┐
│    payments      │
└──────────────────┘
```

---

## 3. Sequence Diagrams

### 3.1 Complete Procurement Flow (End-to-End)

```
┌────────┐     ┌────────┐     ┌────────┐     ┌────────┐     ┌────────┐     ┌────────┐
│  User  │     │  User  │     │ Budget │     │Requisit│     │ Vendor │     │Order & │
│(Browser│     │Service │     │Service │     │Service │     │Service │     │Payment │
└───┬────┘     └───┬────┘     └───┬────┘     └───┬────┘     └───┬────┘     └───┬────┘
    │              │              │              │              │              │
    │ 1. Login     │              │              │              │              │
    ├─────────────►│              │              │              │              │
    │   (Keycloak) │              │              │              │              │
    │◄─────────────┤              │              │              │              │
    │   JWT Token  │              │              │              │              │
    │              │              │              │              │              │
    │ 2. Create Purchase Request  │              │              │              │
    ├─────────────────────────────┼─────────────►│              │              │
    │              │              │              │              │              │
    │              │              │ 3. Check Budget              │              │
    │              │              │◄─────────────┤              │              │
    │              │              ├─────────────►│              │              │
    │              │              │  Available   │              │              │
    │              │              │              │              │              │
    │              │ 4. Get Approvers             │              │              │
    │              │◄─────────────┼──────────────┤              │              │
    │              ├─────────────►│              │              │              │
    │              │  Approver List              │              │              │
    │              │              │              │              │              │
    │              │              │ 5. Create Approval Steps    │              │
    │              │              │              │──────┐       │              │
    │              │              │              │      │       │              │
    │              │              │              │◄─────┘       │              │
    │◄─────────────┼──────────────┼──────────────┤              │              │
    │   Request Created (PENDING_APPROVAL)       │              │              │
    │              │              │              │              │              │
```

### 3.2 Approval Workflow Sequence

```
┌────────┐     ┌────────┐     ┌────────┐     ┌────────┐     ┌────────┐
│Requester│    │ Manager│     │Requisit│     │ Kafka  │     │  Email │
│        │     │        │     │Service │     │        │     │Gateway │
└───┬────┘     └───┬────┘     └───┬────┘     └───┬────┘     └───┬────┘
    │              │              │              │              │
    │ 1. Submit Request           │              │              │
    ├─────────────────────────────►              │              │
    │              │              │              │              │
    │              │              │ 2. Publish: request.created │
    │              │              ├─────────────►│              │
    │              │              │              │              │
    │              │              │              │ 3. Consume   │
    │              │              │              ├─────────────►│
    │              │              │              │   Send Email │
    │              │              │              │   to Manager │
    │              │              │              │              │
    │              │ 4. Email: "Approval Required"              │
    │              │◄─────────────┼──────────────┼──────────────┤
    │              │              │              │              │
    │              │ 5. Approve Request          │              │
    │              ├─────────────►│              │              │
    │              │              │              │              │
    │              │              │ 6. Check: Amount > $5000?   │
    │              │              │──────┐       │              │
    │              │              │      │ Yes   │              │
    │              │              │◄─────┘       │              │
    │              │              │              │              │
    │              │              │ 7. Create next approval step│
    │              │              │   (DEPT_HEAD or FINANCE)    │
    │              │              │──────┐       │              │
    │              │              │◄─────┘       │              │
    │              │              │              │              │
    │              │              │ 8. Publish: step.approved   │
    │              │              ├─────────────►│              │
    │              │              │              │──────────────►
    │              │              │              │   Notify next│
    │              │              │              │   approver   │
    │              │              │              │              │
    │              │              │ ... repeat until final approval
    │              │              │              │              │
    │              │              │ 9. Final: status = APPROVED │
    │              │              ├─────────────►│              │
    │              │              │   request.approved          │
    │              │              │              │              │
    │ 10. Email: "Request Approved"              │              │
    │◄─────────────┼──────────────┼──────────────┼──────────────┤
    │              │              │              │              │
```

### 3.3 Vendor Quotation Sequence

```
┌────────┐     ┌────────┐     ┌────────┐     ┌────────┐     ┌────────┐
│Procurem│     │ Vendor │     │ Vendor │     │ Kafka  │     │ Vendor │
│  User  │     │Service │     │(Portal)│     │        │     │ (Email)│
└───┬────┘     └───┬────┘     └───┬────┘     └───┬────┘     └───┬────┘
    │              │              │              │              │
    │ 1. Request approved (from Requisition Service)           │
    │◄─────────────┤              │              │              │
    │              │              │              │              │
    │ 2. Create RFQ│              │              │              │
    ├─────────────►│              │              │              │
    │              │              │              │              │
    │              │ 3. Select Vendors           │              │
    │              │   (by category)             │              │
    │              │──────┐       │              │              │
    │              │◄─────┘       │              │              │
    │              │              │              │              │
    │              │ 4. Send RFQ to vendors      │              │
    │              ├─────────────────────────────┼─────────────►│
    │              │              │              │   RFQ Email  │
    │              │              │              │              │
    │              │              │ 5. Vendor logs in           │
    │              │              │◄─────────────┼──────────────┤
    │              │              │              │              │
    │              │ 6. Vendor views RFQ         │              │
    │              │◄─────────────┤              │              │
    │              │              │              │              │
    │              │ 7. Vendor submits quotation │              │
    │              │◄─────────────┤              │              │
    │              │              │              │              │
    │              │ 8. Publish: quotation.received             │
    │              ├──────────────┼─────────────►│              │
    │              │              │              │              │
    │ 9. Notification: "New quotation received" │              │
    │◄─────────────┤              │              │              │
    │              │              │              │              │
    │  ... more vendors submit ...│              │              │
    │              │              │              │              │
    │ 10. RFQ Deadline reached    │              │              │
    │              │──────┐       │              │              │
    │              │◄─────┘       │              │              │
    │              │              │              │              │
    │ 11. Compare quotations      │              │              │
    ├─────────────►│              │              │              │
    │◄─────────────┤              │              │              │
    │   Comparison table          │              │              │
    │              │              │              │              │
    │ 12. Select vendor           │              │              │
    ├─────────────►│              │              │              │
    │              │              │              │              │
    │              │ 13. Publish: vendor.selected│              │
    │              ├─────────────────────────────►              │
    │              │              │              │              │
```

### 3.4 Order, Receipt & Payment Sequence

```
┌────────┐     ┌────────┐     ┌────────┐     ┌────────┐     ┌────────┐
│Procurem│     │Order & │     │ Budget │     │ Vendor │     │ Finance│
│  User  │     │Payment │     │Service │     │(Seller)│     │  User  │
└───┬────┘     └───┬────┘     └───┬────┘     └───┬────┘     └───┬────┘
    │              │              │              │              │
    │ 1. Vendor selected (from Vendor Service)  │              │
    │◄─────────────┤              │              │              │
    │              │              │              │              │
    │ 2. Create Purchase Order    │              │              │
    ├─────────────►│              │              │              │
    │              │              │              │              │
    │              │ 3. Reserve Budget           │              │
    │              ├─────────────►│              │              │
    │              │◄─────────────┤              │              │
    │              │   Reserved   │              │              │
    │              │              │              │              │
    │              │ 4. Send PO to Vendor        │              │
    │              ├──────────────┼─────────────►│              │
    │              │              │              │              │
    │              │              │  ... vendor delivers goods ...
    │              │              │              │              │
    │ 5. Confirm Goods Receipt    │              │              │
    ├─────────────►│              │              │              │
    │              │              │              │              │
    │              │ 6. Update received qty      │              │
    │              │──────┐       │              │              │
    │              │◄─────┘       │              │              │
    │              │              │              │              │
    │              │              │ 7. Vendor sends invoice     │
    │              │◄─────────────┼──────────────┤              │
    │              │              │              │              │
    │              │ 8. 3-Way Matching           │              │
    │              │   PO vs Receipt vs Invoice  │              │
    │              │──────┐       │              │              │
    │              │◄─────┘       │              │              │
    │              │              │              │              │
    │              │              │              │ 9. Invoice matched
    │              ├──────────────┼──────────────┼─────────────►│
    │              │              │              │              │
    │              │              │              │ 10. Approve Payment
    │              │◄─────────────┼──────────────┼──────────────┤
    │              │              │              │              │
    │              │ 11. Process Payment         │              │
    │              │──────┐       │              │              │
    │              │◄─────┘       │              │              │
    │              │              │              │              │
    │              │ 12. Convert reservation to spent           │
    │              ├─────────────►│              │              │
    │              │              │──────┐       │              │
    │              │              │◄─────┘       │              │
    │              │              │   Budget updated            │
    │              │              │              │              │
    │              │ 13. Publish: payment.completed             │
    │              ├──────────────┼──────────────┼──────────────►
    │              │              │              │              │
```

### 3.5 Budget Check Sequence (Detailed)

```
┌────────┐     ┌────────┐     ┌────────┐
│Requisit│     │ Budget │     │Database│
│Service │     │Service │     │        │
└───┬────┘     └───┬────┘     └───┬────┘
    │              │              │
    │ 1. POST /budgets/check      │
    │   {dept_id, amount}         │
    ├─────────────►│              │
    │              │              │
    │              │ 2. SELECT budget WHERE dept_id = ?
    │              ├─────────────►│
    │              │◄─────────────┤
    │              │   {total: 100000, spent: 30000, reserved: 15000}
    │              │              │
    │              │ 3. Calculate │
    │              │   available = total - spent - reserved
    │              │   available = 100000 - 30000 - 15000 = 55000
    │              │──────┐       │
    │              │◄─────┘       │
    │              │              │
    │              │ 4. Compare: request_amount <= available?
    │              │──────┐       │
    │              │◄─────┘       │
    │              │              │
    │◄─────────────┤              │
    │   {                         │
    │     "available": true,      │
    │     "budget_id": "...",     │
    │     "available_amount": 55000,
    │     "requested_amount": 10000
    │   }                         │
    │              │              │
```

---

## 4. State Diagrams

### 4.1 Purchase Request States

```
                                    ┌─────────────┐
                                    │   DRAFT     │
                                    └──────┬──────┘
                                           │ submit()
                                           ▼
                           ┌───────────────────────────────┐
                           │      PENDING_APPROVAL         │
                           └───────────────┬───────────────┘
                                           │
                        ┌──────────────────┼──────────────────┐
                        │                  │                  │
                   reject()            approve()          cancel()
                        │                  │                  │
                        ▼                  ▼                  ▼
                 ┌──────────┐      ┌──────────────┐    ┌──────────┐
                 │ REJECTED │      │   APPROVED   │    │CANCELLED │
                 └──────────┘      └──────┬───────┘    └──────────┘
                                          │ sendRfq()
                                          ▼
                                   ┌──────────────┐
                                   │   RFQ_SENT   │
                                   └──────┬───────┘
                                          │ selectVendor()
                                          ▼
                                   ┌──────────────────┐
                                   │ VENDOR_SELECTED  │
                                   └──────┬───────────┘
                                          │ createPO()
                                          ▼
                                   ┌──────────────┐
                                   │  PO_CREATED  │
                                   └──────┬───────┘
                                          │ paymentComplete()
                                          ▼
                                   ┌──────────────┐
                                   │  COMPLETED   │
                                   └──────────────┘
```

### 4.2 Purchase Order States

```
                                    ┌─────────────┐
                                    │   PENDING   │
                                    └──────┬──────┘
                                           │ send()
                                           ▼
                                    ┌─────────────┐
                                    │    SENT     │
                                    └──────┬──────┘
                                           │ vendorAcknowledge()
                                           ▼
                                    ┌──────────────┐
                                    │ ACKNOWLEDGED │
                                    └──────┬───────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        │ partialReceive()                    │ fullReceive()
                        ▼                                     ▼
               ┌─────────────────┐                    ┌──────────────┐
               │PARTIALLY_RECEIVED│                   │   RECEIVED   │
               └────────┬────────┘                    └──────┬───────┘
                        │ fullReceive()                      │
                        └────────────────┬───────────────────┘
                                         │ invoiceReceived()
                                         ▼
                                  ┌──────────────┐
                                  │   INVOICED   │
                                  └──────┬───────┘
                                         │ paymentProcessed()
                                         ▼
                                  ┌──────────────┐
                                  │     PAID     │
                                  └──────────────┘
```

### 4.3 Invoice States

```
                                    ┌─────────────┐
                                    │   PENDING   │
                                    └──────┬──────┘
                                           │ match()
                        ┌──────────────────┴──────────────────┐
                        │                                     │
                        ▼                                     ▼
               ┌──────────────┐                       ┌──────────────┐
               │   MATCHED    │                       │   DISPUTED   │
               └──────┬───────┘                       └──────┬───────┘
                      │ approvePayment()                     │ resolve()
                      ▼                                      │
               ┌──────────────┐                              │
               │   APPROVED   │◄─────────────────────────────┘
               └──────┬───────┘
                      │ processPayment()
                      ▼
               ┌──────────────┐
               │     PAID     │
               └──────────────┘
```

---

*Document Version: 1.0*  
*Created: January 24, 2026*
