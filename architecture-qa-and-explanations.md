# Architecture Q&A and Technical Explanations

This document addresses questions about the Procurement System architecture decisions.

---

## 1. Spring Boot vs NestJS - Decision Criteria

### 1.1 Decision Matrix

| Criteria | Spring Boot | NestJS | Winner For |
|----------|-------------|--------|------------|
| **Transaction Safety** | Excellent (JPA, @Transactional) | Good (TypeORM) | Financial services |
| **Complex Business Logic** | Strong typing, mature patterns | Good with TypeScript | Approval workflows |
| **Development Speed** | Moderate | Fast | Simple CRUD services |
| **I/O Bound Operations** | Thread-per-request | Non-blocking, async | Notifications, external APIs |
| **Memory Footprint** | Higher (JVM) | Lower (Node.js) | Cost-sensitive deployments |
| **Type Safety** | Compile-time (Java) | Compile-time (TypeScript) | Both good |
| **Enterprise Support** | Very mature | Growing | Regulated industries |

---

### 1.2 Why Each Service Uses Its Technology

**USER SERVICE --> NestJS**

Reasons:
- Mostly CRUD operations (create/read/update users, departments)
- Needs to call Keycloak Admin API (external HTTP calls = I/O bound)
- No complex financial calculations
- Fast development for user management features

If it was Spring Boot:
- Overkill for simple CRUD
- Slower development time

---

**BUDGET SERVICE --> Spring Boot**

Reasons:
- Financial calculations (available = total - spent - reserved)
- ACID transactions critical (reserve budget atomically)
- Race condition prevention (two requests checking same budget)
- Decimal precision matters (BigDecimal in Java vs JavaScript floats)

Example - Why transactions matter:

```
Request A: Check budget --> $10,000 available
Request B: Check budget --> $10,000 available (same time)
Request A: Reserve $8,000 --> Success
Request B: Reserve $8,000 --> Should FAIL (only $2,000 left)

Spring Boot @Transactional + DB locks = Prevents this race condition
```

---

**REQUISITION SERVICE --> Spring Boot**

Reasons:
- Complex state machine (DRAFT --> PENDING --> APPROVED --> ... --> COMPLETED)
- Multi-step approval workflow with business rules
- Needs to coordinate with Budget Service (distributed transaction)
- Heavy validation logic

Example - Approval rules:

```
if (amount <= 5000)  --> Manager approval only
if (amount <= 50000) --> Manager + Dept Head
if (amount > 50000)  --> Manager + Dept Head + Finance
if (category == "IT" && amount > 10000) --> Add IT Director

Spring Boot is better for implementing complex business rules
```

---

**VENDOR SERVICE --> NestJS**

Reasons:
- Mostly CRUD (vendors, quotations)
- Sends emails to vendors (I/O bound - waiting for SMTP)
- Calls external vendor APIs for verification (I/O bound)
- File uploads for quotation documents (I/O bound)
- No complex financial calculations

NestJS async/await handles many concurrent vendor emails efficiently

---

**ORDER & PAYMENT SERVICE --> Spring Boot**

Reasons:
- 3-way matching (PO vs Receipt vs Invoice) - complex logic
- Payment processing - financial accuracy critical
- Must coordinate: reserve budget --> create PO --> release/spend budget
- Audit trail for compliance

3-Way Matching Example:

```
PO Amount:      $10,000
Receipt Value:  $9,800 (based on qty received x unit price)
Invoice Amount: $9,850

Variance: $50 (0.5%)   --> Within 5% tolerance --> AUTO APPROVE
Variance: $2,000 (20%) --> Exceeds tolerance   --> MANUAL REVIEW

This logic needs precision - Spring Boot's BigDecimal is ideal
```

---

### 1.3 Quick Decision Guide

```
                    New Service Needed
                           |
                           v
              Does it handle money/payments?
                    /            \
                  YES             NO
                   |               |
                   v               v
             Spring Boot    Complex state machine
                            or business rules?
                                /        \
                              YES         NO
                               |           |
                               v           v
                         Spring Boot   Mostly CRUD or
                                       external APIs?
                                          /      \
                                        YES       NO
                                         |         |
                                         v         v
                                      NestJS   Either OK
```

---

## 2. Kafka for Notifications - How It Works

### 2.1 Yes, Kafka Replaces RabbitMQ

Both can work, but we chose **Kafka** because:

| Feature | Kafka | RabbitMQ |
|---------|-------|----------|
| Message retention | Keeps messages (configurable) | Deletes after consumed |
| Replay messages | Can replay old events | Cannot replay |
| Audit trail | Natural fit (event log) | Needs extra setup |
| Throughput | Higher | Lower |
| Complexity | More complex | Simpler |

**For procurement system:** Kafka is better because we need audit trail (replay events).

---

### 2.2 How Kafka Handles Email Notifications

**KAFKA EMAIL NOTIFICATION FLOW**

There IS a consumer. Kafka does NOT auto-send to SMTP.

```
+---------------+     +---------------+     +---------------+     +---------+
|  Requisition  |     |               |     |  Notification |     |  SMTP   |
|   Service     |---->|    KAFKA      |---->|   Consumer    |---->| Server  |
|  (Producer)   |     |               |     |  (Worker)     |     |         |
+---------------+     +---------------+     +---------------+     +---------+
       |                     |                     |                   |
       |                     |                     |                   |
  1. Approval           2. Event              3. Consumer          4. Email
  needed, publish       stored in             reads event,         sent to
  event to Kafka        topic                 formats email,       user
                                              sends via SMTP
```

---

### 2.3 Detailed Step-by-Step Flow

**STEP 1: Service Publishes Event**

Requisition Service (when approval is needed):

```java
// Spring Boot - Kafka Producer

@Service
public class RequisitionService {

    @Autowired
    private KafkaTemplate<String, NotificationEvent> kafkaTemplate;

    public void submitForApproval(PurchaseRequest request) {
        // ... save request to database ...

        // Publish notification event
        NotificationEvent event = NotificationEvent.builder()
            .type("APPROVAL_REQUIRED")
            .recipientEmail("manager@company.com")
            .recipientName("John Manager")
            .subject("Approval Required: " + request.getTitle())
            .templateId("approval-request")
            .data(Map.of(
                "requestNumber", request.getRequestNumber(),
                "requesterName", request.getRequesterName(),
                "amount", request.getTotalAmount(),
                "approvalUrl", "https://app.com/approve/" + request.getId()
            ))
            .build();

        kafkaTemplate.send("procurement.notifications", event);
    }
}
```

---

**STEP 2: Event Stored in Kafka Topic**

Kafka Topic: procurement.notifications

```
Partition 0:
+----------+----------+----------+----------+----------+
| Offset 0 | Offset 1 | Offset 2 | Offset 3 | Offset 4 |  ...
| Event A  | Event B  | Event C  | Event D  | Event E  |
+----------+----------+----------+----------+----------+
                                      ^
                                      |
                             Consumer reads here
                             (tracks its position)
```

---

**STEP 3: Notification Consumer Processes Events**

This can be:
- A simple standalone worker (Node.js script)
- Part of Vendor Service (embedded)
- A small NestJS microservice

```typescript
// NestJS - Kafka Consumer

@Injectable()
export class NotificationConsumer {

    constructor(
        private emailService: EmailService,
        private templateService: TemplateService
    ) {}

    @EventPattern('procurement.notifications')
    async handleNotification(event: NotificationEvent) {

        // 1. Load email template
        const template = await this.templateService
            .getTemplate(event.templateId);

        // 2. Render template with data
        const htmlBody = this.templateService.render(
            template,
            event.data
        );

        // 3. Send email via SMTP
        await this.emailService.send({
            to: event.recipientEmail,
            subject: event.subject,
            html: htmlBody
        });

        console.log(`Email sent to ${event.recipientEmail}`);
    }
}
```

---

**STEP 4: Email Service Sends to SMTP**

```typescript
// Email Service (using nodemailer)

@Injectable()
export class EmailService {

    private transporter;

    constructor() {
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,      // e.g., smtp.gmail.com
            port: 587,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS   // From Vault
            }
        });
    }

    async send(options: EmailOptions) {
        await this.transporter.sendMail({
            from: 'procurement@company.com',
            to: options.to,
            subject: options.subject,
            html: options.html
        });
    }
}
```

---

### 2.4 Complete Notification Flow Diagram

**NOTIFICATION FLOW (END-TO-END)**

```
+--------------+
| Requisition  | 1. Request submitted
|   Service    |----+
+--------------+    |
                    |   Event: { type: "APPROVAL_REQUIRED", ... }
                    v
              +-----------+
              |           |
              |   KAFKA   |  Topic: procurement.notifications
              |           |
              +-----+-----+
                    |
        +-----------+-----------+
        |           |           |
        v           v           v
  +------------+ +--------+ +------------+
  |Notification| | Audit  | |  Other     |
  | Consumer   | |Consumer| | Consumers  |
  +-----+------+ +----+---+ +------------+
        |             |
        |             |  (Audit: save to Elasticsearch)
        v             v
  +------------+ +-------------+
  |  Template  | |Elasticsearch|
  |  Engine    | +-------------+
  +-----+------+
        |
        | Rendered HTML email
        v
  +------------+
  |   SMTP     |
  |  Server    |
  +-----+------+
        |
        v
  +------------+
  |  Manager's |  "You have a new approval request"
  |   Inbox    |
  +------------+
```

---

### 2.5 Types of Notification Events

Topic: procurement.notifications

| Event Type | Trigger | Recipients |
|------------|---------|------------|
| APPROVAL_REQUIRED | Request submitted | Approver(s) |
| REQUEST_APPROVED | All approvals complete | Requester |
| REQUEST_REJECTED | Any approver rejects | Requester |
| RFQ_SENT | RFQ created | Selected vendors |
| QUOTATION_RECEIVED | Vendor submits quote | Procurement team |
| VENDOR_SELECTED | Vendor chosen | Vendor, Requester |
| PO_CREATED | Purchase order created | Vendor |
| GOODS_RECEIVED | Delivery confirmed | Finance |
| INVOICE_MATCHED | 3-way match success | Finance |
| PAYMENT_COMPLETED | Payment processed | Vendor, Requester |
| BUDGET_LOW | Budget < 20% | Dept Head, Finance |

---

## 3. Elasticsearch for Audit - How It Works

### 3.1 Yes, Elasticsearch is Persistent Storage

**ELASTICSEARCH PERSISTENCE**

- Elasticsearch stores data on disk (persistent)
- Supports replication for high availability
- Can retain data for years (configurable)
- Optimized for:
  - Full-text search (find by keywords)
  - Time-series data (when did something happen)
  - Aggregations (how many requests approved this month)

Storage Location:
```
/var/lib/elasticsearch/data/
    +-- indices/
        +-- procurement-audit-2026.01/
            +-- 0/  (shard 0)
            +-- 1/  (shard 1)
            +-- ...
```

---

### 3.2 Why Elasticsearch Instead of PostgreSQL for Audit?

| Requirement | PostgreSQL | Elasticsearch |
|-------------|------------|---------------|
| Search "laptop" in all fields | Slow (LIKE queries) | Fast (inverted index) |
| Store millions of events | Gets slow | Designed for this |
| Time-range queries | OK with indexes | Optimized for time-series |
| Aggregations (count by user) | OK | Very fast |
| Schema flexibility | Fixed schema | Dynamic fields |
| Complex joins | Excellent | Not designed for this |

**Verdict:** Audit logs are write-heavy, search-heavy, no joins needed --> Elasticsearch wins.

---

### 3.3 How Audit Works (Step by Step)

**AUDIT FLOW**

**STEP 1: Every Service Publishes Events to Kafka**

```
+--------------+    +--------------+    +--------------+
|    User      |    |   Budget     |    | Requisition  |
|   Service    |    |   Service    |    |   Service    |
+------+-------+    +------+-------+    +------+-------+
       |                   |                   |
       | user.created      | budget.reserved   | request.approved
       |                   |                   |
       +-------------------+---------+---------+
                                     |
                                     v
                              +-------------+
                              |    KAFKA    |
                              |  (all events|
                              |   stored)   |
                              +------+------+
                                     |
```

**STEP 2: Audit Consumer Reads All Events**

```
                                     |
                                     v
                              +-------------+
                              |   Audit     |
                              |  Consumer   |
                              |  (Worker)   |
                              +------+------+
                                     |
                                     | Transform & Index
                                     |
```

**STEP 3: Store in Elasticsearch**

```
                                     v
                              +-------------+
                              |Elasticsearch|
                              |             |
                              | Index:      |
                              | audit-2026  |
                              +-------------+
```

---

### 3.4 Audit Event Structure

```json
// Example audit event stored in Elasticsearch

{
  "eventId": "evt-550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-01-25T10:30:00Z",
  "eventType": "REQUEST_APPROVED",
  "serviceName": "requisition-service",
  
  "actor": {
    "userId": "user-123",
    "email": "john.manager@company.com",
    "name": "John Manager",
    "role": "MANAGER",
    "department": "IT"
  },
  
  "resource": {
    "type": "PurchaseRequest",
    "id": "req-456",
    "identifier": "PR-2026-00042"
  },
  
  "action": {
    "type": "APPROVE",
    "description": "Approved purchase request for 10 laptops",
    "reason": "Within budget and justified need"
  },
  
  "context": {
    "ipAddress": "192.168.1.100",
    "userAgent": "Mozilla/5.0...",
    "requestId": "trace-789",
    "previousState": "PENDING_APPROVAL",
    "newState": "APPROVED"
  },
  
  "metadata": {
    "requestAmount": 15000.00,
    "department": "Engineering",
    "approvalLevel": 1,
    "totalApprovalLevels": 2
  }
}
```

---

### 3.5 Audit Consumer Code

```typescript
// Audit Consumer (listens to ALL events)

@Injectable()
export class AuditConsumer {

    constructor(private elasticService: ElasticsearchService) {}

    // Listen to all procurement events
    @EventPattern('procurement.*')
    async handleAuditEvent(event: any) {

        const auditRecord = {
            eventId: uuid(),
            timestamp: new Date().toISOString(),
            eventType: event.type,
            serviceName: event.source,
            actor: event.actor,
            resource: event.resource,
            action: event.action,
            context: event.context,
            metadata: event.data
        };

        // Index to Elasticsearch
        await this.elasticService.index({
            index: `audit-${new Date().getFullYear()}`,
            body: auditRecord
        });
    }
}
```

---

### 3.6 How to Do an Audit (Query Examples)

**AUDIT QUERY EXAMPLES**

**SCENARIO 1: "Who approved request PR-2026-00042?"**

```json
GET /audit-2026/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "resource.identifier": "PR-2026-00042" } },
        { "match": { "action.type": "APPROVE" } }
      ]
    }
  }
}
```

Result:
- John Manager approved on 2026-01-25 at 10:30 AM
- Sarah Director approved on 2026-01-25 at 2:15 PM

---

**SCENARIO 2: "What did user john.manager do last week?"**

```json
GET /audit-2026/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "actor.email": "john.manager@company.com" } },
        { "range": { "timestamp": { "gte": "2026-01-18", "lte": "2026-01-25" }}}
      ]
    }
  },
  "sort": [{ "timestamp": "desc" }]
}
```

Result:
- 2026-01-25 10:30 - Approved PR-2026-00042
- 2026-01-24 16:00 - Rejected PR-2026-00041 (reason: over budget)
- 2026-01-23 09:15 - Approved PR-2026-00039
- 2026-01-20 11:00 - Created budget top-up request

---

**SCENARIO 3: "Why was vendor ABC selected over cheaper vendor XYZ?"**

```json
GET /audit-2026/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "eventType": "VENDOR_SELECTED" } },
        { "match": { "resource.id": "rfq-789" } }
      ]
    }
  }
}
```

Result:
- Actor: procurement.lead@company.com
- Selected: Vendor ABC ($12,000)
- Rejected: Vendor XYZ ($10,500)
- Reason: "Vendor ABC offers 2-year warranty vs 6 months for XYZ. Better delivery time (5 days vs 21 days). Previous good experience with ABC on similar orders."
- Approved by: finance.director@company.com

---

**SCENARIO 4: "Monthly report: How many requests per department?"**

```json
GET /audit-2026/_search
{
  "size": 0,
  "query": {
    "bool": {
      "must": [
        { "match": { "eventType": "REQUEST_CREATED" } },
        { "range": { "timestamp": { "gte": "2026-01-01", "lte": "2026-01-31" }}}
      ]
    }
  },
  "aggs": {
    "by_department": {
      "terms": { "field": "metadata.department.keyword" }
    }
  }
}
```

Result:
| Department | Requests Created |
|------------|-----------------|
| Engineering | 42 |
| Marketing | 28 |
| Operations | 23 |
| HR | 15 |
| Finance | 8 |

---

### 3.7 Audit Dashboard (Kibana)

Elasticsearch comes with Kibana for visualization.

Access: http://localhost:5601 (Kibana)

Features:
- Total Events count
- Approvals Today / Rejections count
- Events Over Time chart
- Recent Events list with search

---

## 4. Summary

| Question | Answer |
|----------|--------|
| **Spring Boot vs NestJS?** | Spring Boot for financial/complex logic; NestJS for CRUD/I/O-bound |
| **RabbitMQ vs Kafka?** | Kafka preferred (audit trail, message retention) |
| **How does Kafka email work?** | Producer publishes --> Kafka stores --> Consumer reads --> Sends via SMTP |
| **Is Kafka auto-sending?** | No, there must be a consumer that processes and sends |
| **Is Elasticsearch persistent?** | Yes, stores on disk with replication |
| **How to audit?** | All events --> Kafka --> Audit Consumer --> Elasticsearch --> Query/Kibana |

---

## 4. Client Questions - Deep Dive

### 4.1 RabbitMQ vs Kafka - Which One to Use?

**Q1: For the Kafka, does RabbitMQ meet our use case as well?**

**Answer: Both can work, but Kafka is recommended for this system.**

| Criteria | Kafka | RabbitMQ | Winner |
|----------|-------|----------|--------|
| **Message Persistence** | Messages stored permanently (configurable retention) | Messages deleted after consumed | Kafka |
| **Event Replay** | Can replay old events for audit | Cannot replay | Kafka |
| **Audit Trail** | Natural event log | Requires additional setup | Kafka |
| **Throughput** | Millions msg/sec | Thousands msg/sec | Kafka |
| **Learning Curve** | Steeper | Easier | RabbitMQ |
| **Use Case Fit** | Event-driven systems, audit logs | Task queues, job processing | Kafka for us |

**Why Kafka is Better for Procurement:**

```
PROCUREMENT SYSTEM NEEDS:
✅ Audit trail - replay events from months ago
✅ Multiple consumers - same event to audit, notifications, analytics
✅ High throughput - many concurrent requests
✅ Event sourcing - rebuild state from events

KAFKA STRENGTHS:
✓ Events stored as log (never deleted unless retention policy)
✓ Multiple consumers can read same message
✓ Can replay events for debugging/audit
✓ Natural fit for event sourcing

RABBITMQ STRENGTHS:
✓ Simpler to set up
✓ Traditional message queue patterns
✓ Better for request/reply patterns
✓ Message deleted after consumed (not good for audit)
```

**Migration Consideration:**

If you already have RabbitMQ expertise, you CAN use it, but you'll need:
- External audit storage (still need Elasticsearch)
- Message copies for audit (not automatic)
- More complex replay mechanism

**Verdict: Kafka is worth the extra complexity for this system.**

---

**Q2: It seems like we need a notification microservice to read from Kafka for sending email as well?**

**Answer: YES, you need a consumer (can be simple).**

Options:

**OPTION 1: Lightweight Notification Worker (Recommended)**

```
Small NestJS app that only:
- Listens to Kafka topic: procurement.notifications
- Reads email templates
- Sends via SMTP
- Logs success/failure

Deployment: Single pod in K8s (low resource)
Code: ~200 lines
```

**OPTION 2: Embed in Vendor Service**

```
Add Kafka consumer to existing Vendor Service
Pro: No new service
Con: Vendor Service handles notifications (mixed responsibility)
```

**OPTION 3: Use Existing Email Gateway**

```
If company already has email gateway service:
- Just publish to Kafka
- Email gateway consumes and sends
```

**Recommended Architecture:**

```
┌──────────────┐      ┌────────────┐      ┌─────────────────┐      ┌──────┐
│ Requisition  │─────►│   KAFKA    │─────►│  Notification   │─────►│ SMTP │
│   Service    │      │   Topic    │      │     Worker      │      │      │
└──────────────┘      └────────────┘      └─────────────────┘      └──────┘
     Produces              Stores              Consumes              Sends
   notification          messages            + formats HTML
     events
```

**Simple Notification Worker Code:**

```typescript
// notification-worker/src/main.ts

import { Kafka } from 'kafkajs';
import nodemailer from 'nodemailer';

const kafka = new Kafka({
  brokers: ['kafka:9092']
});

const consumer = kafka.consumer({ groupId: 'notification-group' });
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function run() {
  await consumer.connect();
  await consumer.subscribe({ topic: 'procurement.notifications' });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const event = JSON.parse(message.value.toString());
      
      // Send email
      await transporter.sendMail({
        to: event.recipientEmail,
        subject: event.subject,
        html: renderTemplate(event.templateId, event.data)
      });
      
      console.log(`Email sent to ${event.recipientEmail}`);
    }
  });
}

run();
```

**Verdict: Yes, you need a simple notification consumer (~1-2 days to build).**

---

### 4.2 Race Conditions & Database Locks

**Q3: How does Spring Boot @Transactional + DB locks prevents race condition (two requests checking same budget)?**

**Answer: Using pessimistic locking to prevent concurrent budget checks.**

**THE PROBLEM:**

```
TIME    REQUEST A                    REQUEST B
t0      Check budget: $10,000 available
t1                                   Check budget: $10,000 available
t2      Reserve $8,000 (balance = $2,000)
t3                                   Reserve $8,000 (ERROR: overdraft!)
t4      ❌ PROBLEM: Both saw $10,000, but only $10,000 exists
```

**THE SOLUTION: Database Row Locking**

```java
// Budget Service - Spring Boot

@Service
public class BudgetService {

    @Autowired
    private BudgetRepository budgetRepository;
    
    @Autowired
    private BudgetTransactionRepository transactionRepository;

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public ReservationResult reserveBudget(
        UUID departmentId, 
        BigDecimal amount
    ) {
        // 1. LOCK the budget row - other transactions must wait
        DepartmentBudget budget = budgetRepository
            .findByDepartmentIdWithLock(departmentId);
            // SELECT * FROM department_budgets 
            // WHERE department_id = ? 
            // FOR UPDATE
        
        // 2. Calculate available amount
        BigDecimal available = budget.getTotalAmount()
            .subtract(budget.getSpentAmount())
            .subtract(budget.getReservedAmount());
        
        // 3. Check if sufficient
        if (available.compareTo(amount) < 0) {
            return ReservationResult.insufficient(available);
        }
        
        // 4. Reserve the amount
        budget.setReservedAmount(
            budget.getReservedAmount().add(amount)
        );
        budgetRepository.save(budget);
        
        // 5. Create transaction record
        BudgetTransaction txn = BudgetTransaction.builder()
            .budgetId(budget.getId())
            .transactionType("RESERVE")
            .amount(amount)
            .build();
        transactionRepository.save(txn);
        
        return ReservationResult.success();
    }
    // Lock released when transaction commits
}
```

**Repository with Locking:**

```java
public interface BudgetRepository extends JpaRepository<DepartmentBudget, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT b FROM DepartmentBudget b WHERE b.departmentId = :deptId")
    DepartmentBudget findByDepartmentIdWithLock(@Param("deptId") UUID deptId);
}
```

**What Happens with Lock:**

```
TIME    REQUEST A                           REQUEST B
t0      START transaction
t1      SELECT ... FOR UPDATE               
        (LOCK acquired on row)
t2                                          START transaction
t3                                          SELECT ... FOR UPDATE
                                            (BLOCKED - waiting for lock)
t4      Check: $10,000 available
t5      Reserve $8,000
        (balance = $2,000)
t6      COMMIT (lock released)             
t7                                          (LOCK acquired)
t8                                          Check: $2,000 available
t9                                          Reserve $8,000
                                            (INSUFFICIENT - rejected)
t10                                         ROLLBACK
```

**Key Points:**

1. **FOR UPDATE** locks the row - no other transaction can modify it
2. Request B waits until Request A completes
3. When Request B runs, it sees the updated balance ($2,000)
4. Race condition prevented ✅

**Alternative: Optimistic Locking**

```java
@Entity
public class DepartmentBudget {
    
    @Version
    private Long version;  // Automatically incremented on update
    
    // If version changed since read, transaction fails
}
```

Optimistic is faster but requires retry logic. Pessimistic is simpler for budget operations.

---

### 4.3 Distributed Transactions

**Q4: In what scenarios will REQUISITION SERVICE need to coordinate with BUDGET SERVICE for distributed transaction?**

**Answer: Distributed transactions are NOT used. We use event-driven choreography instead.**

**Why NOT Distributed Transactions (2PC)?**

```
PROBLEMS WITH 2-PHASE COMMIT:
❌ Slow (multiple round trips)
❌ Locks held across services (blocking)
❌ If Budget Service is down, Requisition Service blocks
❌ Complex failure scenarios
❌ Not cloud-native pattern
```

**Our Approach: Event-Driven Saga Pattern**

**SCENARIO: Create Purchase Request**

```
┌────────────────────────────────────────────────────────────────────┐
│                    SAGA: CREATE PURCHASE REQUEST                    │
└────────────────────────────────────────────────────────────────────┘

1. REQUISITION SERVICE
   ├─ Validate request
   ├─ Save as DRAFT
   ├─ Publish: RequestCreated event
   └─ Return to user: "Request submitted"

2. BUDGET SERVICE (consumes RequestCreated)
   ├─ Check available budget
   ├─ IF sufficient:
   │  ├─ Reserve budget
   │  └─ Publish: BudgetReserved event
   └─ IF insufficient:
      ├─ Publish: BudgetInsufficient event

3. REQUISITION SERVICE (consumes BudgetReserved/Insufficient)
   ├─ IF BudgetReserved:
   │  ├─ Update status to PENDING_APPROVAL
   │  └─ Publish: ReadyForApproval event
   └─ IF BudgetInsufficient:
      ├─ Update status to REJECTED
      └─ Publish: RequestRejected event

4. NOTIFICATION SERVICE
   └─ Send email based on final status
```

**Code Example:**

```java
// Requisition Service

@Service
public class RequisitionService {
    
    @Autowired
    private PurchaseRequestRepository requestRepository;
    
    @Autowired
    private KafkaTemplate<String, Event> kafkaTemplate;
    
    public PurchaseRequest createRequest(CreateRequestDto dto) {
        // 1. Create request in DRAFT status
        PurchaseRequest request = PurchaseRequest.builder()
            .status(RequestStatus.DRAFT)
            .totalAmount(dto.getTotalAmount())
            .departmentId(dto.getDepartmentId())
            .build();
        
        request = requestRepository.save(request);
        
        // 2. Publish event - Budget Service will react
        RequestCreatedEvent event = RequestCreatedEvent.builder()
            .requestId(request.getId())
            .departmentId(dto.getDepartmentId())
            .amount(dto.getTotalAmount())
            .build();
        
        kafkaTemplate.send("procurement.requests", event);
        
        // 3. Return immediately (async processing)
        return request;
    }
    
    @KafkaListener(topics = "procurement.budgets")
    public void handleBudgetEvents(BudgetEvent event) {
        if (event instanceof BudgetReservedEvent) {
            // Budget OK - move to next step
            PurchaseRequest request = requestRepository
                .findById(event.getRequestId())
                .orElseThrow();
            
            request.setStatus(RequestStatus.PENDING_APPROVAL);
            requestRepository.save(request);
            
            // Trigger approval workflow
            startApprovalWorkflow(request);
            
        } else if (event instanceof BudgetInsufficientEvent) {
            // Budget failed - reject request
            PurchaseRequest request = requestRepository
                .findById(event.getRequestId())
                .orElseThrow();
            
            request.setStatus(RequestStatus.REJECTED);
            request.setRejectionReason("Insufficient budget");
            requestRepository.save(request);
        }
    }
}
```

**SCENARIO 2: Create Purchase Order (Reserve Budget)**

```
1. ORDER SERVICE
   ├─ Create PO
   ├─ Publish: POCreated { orderId, departmentId, amount }
   
2. BUDGET SERVICE (consumes POCreated)
   ├─ Move from RESERVED → SPENT
   ├─ Update: spent_amount += amount
   ├─ Update: reserved_amount -= amount
   ├─ Publish: BudgetSpent
   
3. ORDER SERVICE (consumes BudgetSpent)
   └─ Update PO status to CONFIRMED
```

**Compensation (Rollback)**

If PO is cancelled:

```
1. ORDER SERVICE
   ├─ Cancel PO
   ├─ Publish: POCancelled
   
2. BUDGET SERVICE
   ├─ Release reservation
   ├─ Update: reserved_amount -= amount
   └─ Publish: BudgetReleased
```

**Key Points:**

1. **No distributed transactions** - each service has its own transaction
2. **Eventually consistent** - takes time for saga to complete
3. **Resilient** - if Budget Service is down, events wait in Kafka
4. **Compensating actions** - undo operations if needed

---

### 4.4 File Storage for PDFs

**Q5: I also want to store quotation pdf, invoice pdf, where should I store them?**

**Answer: Use MinIO (S3-compatible) object storage.**

**Storage Architecture:**

```
┌────────────────────────────────────────────────────────────────────┐
│                    FILE STORAGE ARCHITECTURE                        │
└────────────────────────────────────────────────────────────────────┘

                     ┌──────────────┐
                     │    USER      │
                     └──────┬───────┘
                            │ Upload PDF
                            ▼
                     ┌──────────────┐
                     │   VENDOR     │
                     │   SERVICE    │
                     └──────┬───────┘
                            │
                            │ 1. Generate pre-signed URL
                            ▼
                     ┌──────────────┐
                     │    MinIO     │
                     │  (S3-like)   │
                     └──────┬───────┘
                            │
                            │ 2. Store file
                            │ 3. Return storage path
                            ▼
                     ┌──────────────┐
                     │  PostgreSQL  │
                     │  (metadata)  │
                     └──────────────┘
                     
Storage in DB:
- file_name: "invoice-123.pdf"
- storage_path: "quotations/2026/01/uuid.pdf"
- file_size: 1048576
- uploaded_at: 2026-01-25

Actual file in MinIO bucket: procurement-documents
```

**Database Schema (Already Defined):**

```sql
-- attachments table in requisition service
CREATE TABLE attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID REFERENCES purchase_requests(id),
    file_name       VARCHAR(255) NOT NULL,
    file_type       VARCHAR(100),
    file_size       INTEGER,
    storage_path    VARCHAR(500) NOT NULL,  -- MinIO path
    uploaded_by     UUID NOT NULL,
    uploaded_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Similar tables in vendor service for quotations
-- and order service for invoices
```

**File Upload Flow:**

```java
// Vendor Service - Upload Quotation PDF

@RestController
@RequestMapping("/api/quotations")
public class QuotationController {
    
    @Autowired
    private MinioService minioService;
    
    @Autowired
    private QuotationRepository quotationRepository;
    
    @PostMapping("/{id}/upload")
    public ResponseEntity<?> uploadQuotationPdf(
        @PathVariable UUID id,
        @RequestParam("file") MultipartFile file
    ) {
        // 1. Validate file
        if (!file.getContentType().equals("application/pdf")) {
            throw new BadRequestException("Only PDF files allowed");
        }
        
        if (file.getSize() > 10_000_000) { // 10MB
            throw new BadRequestException("File too large");
        }
        
        // 2. Generate unique path
        String path = String.format(
            "quotations/%s/%s/%s",
            Year.now().getValue(),
            String.format("%02d", Month.now().getValue()),
            UUID.randomUUID() + ".pdf"
        );
        // Result: quotations/2026/01/550e8400-e29b-41d4-a716.pdf
        
        // 3. Upload to MinIO
        minioService.uploadFile(
            "procurement-documents",  // bucket
            path,
            file.getInputStream(),
            file.getContentType()
        );
        
        // 4. Save metadata to database
        QuotationAttachment attachment = QuotationAttachment.builder()
            .quotationId(id)
            .fileName(file.getOriginalFilename())
            .fileType(file.getContentType())
            .fileSize(file.getSize())
            .storagePath(path)
            .uploadedBy(getCurrentUserId())
            .build();
        
        quotationRepository.saveAttachment(attachment);
        
        return ResponseEntity.ok(attachment);
    }
    
    @GetMapping("/{id}/download")
    public ResponseEntity<?> downloadQuotationPdf(@PathVariable UUID id) {
        // 1. Get metadata from DB
        QuotationAttachment attachment = quotationRepository
            .findAttachmentById(id)
            .orElseThrow();
        
        // 2. Generate pre-signed URL (expires in 5 minutes)
        String downloadUrl = minioService.getPresignedUrl(
            "procurement-documents",
            attachment.getStoragePath(),
            Duration.ofMinutes(5)
        );
        
        return ResponseEntity.ok(Map.of("downloadUrl", downloadUrl));
    }
}
```

**MinIO Service:**

```java
@Service
public class MinioService {
    
    private final MinioClient minioClient;
    
    public MinioService(
        @Value("${minio.url}") String url,
        @Value("${minio.access-key}") String accessKey,
        @Value("${minio.secret-key}") String secretKey
    ) {
        this.minioClient = MinioClient.builder()
            .endpoint(url)
            .credentials(accessKey, secretKey)
            .build();
    }
    
    public void uploadFile(
        String bucket, 
        String path, 
        InputStream stream, 
        String contentType
    ) {
        try {
            minioClient.putObject(
                PutObjectArgs.builder()
                    .bucket(bucket)
                    .object(path)
                    .stream(stream, stream.available(), -1)
                    .contentType(contentType)
                    .build()
            );
        } catch (Exception e) {
            throw new FileStorageException("Failed to upload file", e);
        }
    }
    
    public String getPresignedUrl(String bucket, String path, Duration expiry) {
        try {
            return minioClient.getPresignedObjectUrl(
                GetPresignedObjectUrlArgs.builder()
                    .bucket(bucket)
                    .object(path)
                    .expiry((int) expiry.getSeconds())
                    .build()
            );
        } catch (Exception e) {
            throw new FileStorageException("Failed to generate URL", e);
        }
    }
}
```

**File Organization:**

```
MinIO Bucket: procurement-documents
├── quotations/
│   ├── 2026/
│   │   ├── 01/
│   │   │   ├── 550e8400-e29b-41d4-a716.pdf
│   │   │   └── 661f9500-f39c-52e5-b827.pdf
│   │   └── 02/
│   └── 2025/
├── invoices/
│   ├── 2026/
│   │   └── 01/
│   │       └── invoice-12345.pdf
└── attachments/
    └── requests/
        └── 2026/01/
            └── specification-doc.pdf
```

**Why MinIO over Local Filesystem:**

| Feature | MinIO | Local Filesystem |
|---------|-------|------------------|
| Scalability | Distributed, unlimited | Limited by disk |
| Availability | Replicated | Single point of failure |
| Kubernetes-friendly | StatefulSet or external | Requires PersistentVolume |
| S3-compatible | Yes (easy migration) | No |
| Access control | IAM policies | File permissions |
| Backup | Built-in | Manual |

**Production Setup:**

```yaml
# docker-compose.infra.yml

services:
  minio:
    image: minio/minio:latest
    container_name: procurement-minio
    ports:
      - "9000:9000"    # API
      - "9001:9001"    # Console
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      
volumes:
  minio_data:
```

**Verdict: Use MinIO for all PDFs (quotations, invoices, attachments).**

---

### 4.5 Vendor Invoice Submission

**Q6: When the vendor sends us the invoice through a link provided by us, which microservice will handle the request?**

**Answer: ORDER & PAYMENT SERVICE handles invoice submission.**

**Invoice Submission Flow:**

```
┌────────────────────────────────────────────────────────────────────┐
│              VENDOR INVOICE SUBMISSION WORKFLOW                     │
└────────────────────────────────────────────────────────────────────┘

STEP 1: Generate Submission Link
┌──────────────┐
│    ORDER     │  After PO created
│   SERVICE    │  Generate unique link for vendor
└──────┬───────┘
       │
       │ POST /api/purchase-orders/{id}/generate-invoice-link
       ▼
Link: https://portal.company.com/invoice/submit/550e8400-e29b-41d4
      (token contains: PO ID, vendor ID, expiry)
       │
       │ Email sent to vendor
       ▼
┌──────────────┐
│    VENDOR    │  Receives email with link
└──────────────┘


STEP 2: Vendor Submits Invoice
┌──────────────┐
│    VENDOR    │  Clicks link → Opens invoice form
└──────┬───────┘
       │
       │ Fills form:
       │ - Invoice number
       │ - Invoice date
       │ - Amount
       │ - Upload PDF
       ▼
┌──────────────┐
│  API GATEWAY │  Validates token
└──────┬───────┘
       │
       │ POST /api/invoices/submit
       ▼
┌──────────────┐
│    ORDER &   │  1. Validate token
│   PAYMENT    │  2. Validate PO exists
│   SERVICE    │  3. Check not already invoiced
│              │  4. Upload PDF to MinIO
│              │  5. Create invoice record
│              │  6. Perform 3-way matching
└──────┬───────┘
       │
       │ Publish: InvoiceSubmitted event
       ▼
┌──────────────┐
│ NOTIFICATION │  Email finance team:
│   SERVICE    │  "New invoice received"
└──────────────┘
```

**API Endpoint:**

```java
// Order & Payment Service

@RestController
@RequestMapping("/api/invoices")
public class InvoiceController {
    
    @Autowired
    private InvoiceService invoiceService;
    
    @Autowired
    private TokenService tokenService;
    
    /**
     * Vendor submits invoice via public link
     * No authentication required - token validates access
     */
    @PostMapping("/submit")
    public ResponseEntity<?> submitInvoice(
        @RequestParam("token") String token,
        @RequestParam("invoiceNumber") String invoiceNumber,
        @RequestParam("invoiceDate") LocalDate invoiceDate,
        @RequestParam("amount") BigDecimal amount,
        @RequestParam("file") MultipartFile pdfFile
    ) {
        // 1. Validate token
        InvoiceSubmissionToken tokenData = tokenService
            .validateInvoiceToken(token);
        
        if (tokenData.isExpired()) {
            throw new TokenExpiredException("Link expired");
        }
        
        // 2. Validate PO
        PurchaseOrder po = poRepository
            .findById(tokenData.getPurchaseOrderId())
            .orElseThrow();
        
        if (po.getVendorId() != tokenData.getVendorId()) {
            throw new UnauthorizedException("Invalid vendor");
        }
        
        if (po.getStatus() != POStatus.GOODS_RECEIVED) {
            throw new BusinessException("Cannot invoice before goods received");
        }
        
        // 3. Check for duplicate
        if (invoiceRepository.existsByPoId(po.getId())) {
            throw new BusinessException("Invoice already submitted");
        }
        
        // 4. Upload PDF
        String storagePath = minioService.uploadInvoice(
            pdfFile,
            po.getId()
        );
        
        // 5. Create invoice
        Invoice invoice = invoiceService.createInvoice(
            po,
            invoiceNumber,
            invoiceDate,
            amount,
            storagePath
        );
        
        // 6. Perform 3-way matching
        MatchingResult result = invoiceService.perform3WayMatch(invoice);
        
        // 7. Publish event
        kafkaTemplate.send("procurement.invoices", 
            InvoiceSubmittedEvent.builder()
                .invoiceId(invoice.getId())
                .poId(po.getId())
                .vendorId(po.getVendorId())
                .amount(amount)
                .matchingStatus(result.getStatus())
                .build()
        );
        
        return ResponseEntity.ok(Map.of(
            "invoiceId", invoice.getId(),
            "status", "SUBMITTED",
            "matchingResult", result
        ));
    }
}
```

**Generate Invoice Submission Link:**

```java
@Service
public class PurchaseOrderService {
    
    @Autowired
    private TokenService tokenService;
    
    @Autowired
    private EmailService emailService;
    
    public String generateInvoiceSubmissionLink(UUID poId) {
        PurchaseOrder po = poRepository.findById(poId).orElseThrow();
        
        // Generate JWT token (expires in 30 days)
        String token = tokenService.createInvoiceToken(
            po.getId(),
            po.getVendorId(),
            Duration.ofDays(30)
        );
        
        String link = String.format(
            "%s/invoice/submit/%s",
            appConfig.getPublicUrl(),
            token
        );
        
        // Send email to vendor
        emailService.send(
            po.getVendorEmail(),
            "Submit Invoice for PO " + po.getPoNumber(),
            renderInvoiceSubmissionEmail(po, link)
        );
        
        return link;
    }
}
```

**Token Service:**

```java
@Service
public class TokenService {
    
    @Value("${jwt.secret}")
    private String jwtSecret;
    
    public String createInvoiceToken(
        UUID poId, 
        UUID vendorId, 
        Duration expiry
    ) {
        return Jwts.builder()
            .setSubject("invoice-submission")
            .claim("poId", poId.toString())
            .claim("vendorId", vendorId.toString())
            .setIssuedAt(new Date())
            .setExpiration(Date.from(
                Instant.now().plus(expiry)
            ))
            .signWith(SignatureAlgorithm.HS512, jwtSecret)
            .compact();
    }
    
    public InvoiceSubmissionToken validateInvoiceToken(String token) {
        Claims claims = Jwts.parser()
            .setSigningKey(jwtSecret)
            .parseClaimsJws(token)
            .getBody();
        
        return InvoiceSubmissionToken.builder()
            .purchaseOrderId(UUID.fromString(claims.get("poId", String.class)))
            .vendorId(UUID.fromString(claims.get("vendorId", String.class)))
            .expiresAt(claims.getExpiration().toInstant())
            .build();
    }
}
```

**Email Template:**

```html
<p>Dear Vendor,</p>

<p>Your purchase order <strong>{{ po.poNumber }}</strong> has been delivered.</p>

<p>Please submit your invoice using the link below:</p>

<p>
  <a href="{{ invoiceSubmissionLink }}" 
     style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none;">
    Submit Invoice
  </a>
</p>

<p>This link expires in 30 days.</p>

<p><strong>PO Details:</strong></p>
<ul>
  <li>PO Number: {{ po.poNumber }}</li>
  <li>Amount: {{ po.totalAmount }}</li>
  <li>Items: {{ po.itemCount }}</li>
</ul>
```

**Verdict: ORDER & PAYMENT SERVICE handles vendor invoice submission via unique token-based link.**

---

### 4.6 Redis Architecture

**Q7: Do you have a Redis for each microservice?**

**Answer: ONE shared Redis cluster, but each service uses its own keyspace.**

**Redis Architecture:**

```
┌────────────────────────────────────────────────────────────────────┐
│                    REDIS CLUSTER ARCHITECTURE                       │
└────────────────────────────────────────────────────────────────────┘

                     ┌─────────────────────┐
                     │   REDIS CLUSTER     │
                     │   (3 nodes)         │
                     │   • Master          │
                     │   • Replica 1       │
                     │   • Replica 2       │
                     └──────────┬──────────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
    ┌───────────▼────┐  ┌───────▼────┐  ┌──────▼────────┐
    │  User Service  │  │   Budget   │  │  Requisition  │
    │                │  │   Service  │  │   Service     │
    │  Keyspace:     │  │            │  │               │
    │  user:*        │  │ Keyspace:  │  │  Keyspace:    │
    │                │  │ budget:*   │  │  request:*    │
    └────────────────┘  └────────────┘  └───────────────┘

Keys organized by prefix:
- user:session:550e8400        (User Service)
- budget:lock:dept-123         (Budget Service)
- request:idempotency:abc123   (Requisition Service)
```

**Why Shared Redis:**

| Aspect | Shared Redis | Per-Service Redis |
|--------|--------------|-------------------|
| Cost | 1 cluster | 5 clusters |
| Memory efficiency | Better (shared pool) | Waste (over-provisioned) |
| Operational overhead | Low (manage 1) | High (manage 5) |
| Network hops | Same | Same |
| Key collision risk | Use prefixes | None |
| Isolation | Keyspace isolation | Full isolation |

**Verdict: ONE shared Redis cluster with keyspace prefixes per service.**

**Redis Usage Patterns:**

```java
// Budget Service - Redis for distributed locks

@Service
public class BudgetService {
    
    @Autowired
    private RedissonClient redisson;
    
    public ReservationResult reserveBudget(UUID deptId, BigDecimal amount) {
        // Distributed lock key
        String lockKey = "budget:lock:" + deptId.toString();
        
        RLock lock = redisson.getLock(lockKey);
        
        try {
            // Try to acquire lock (wait 5s, release after 10s)
            boolean acquired = lock.tryLock(5, 10, TimeUnit.SECONDS);
            
            if (!acquired) {
                throw new LockException("Could not acquire budget lock");
            }
            
            // Critical section - only one thread/process enters
            DepartmentBudget budget = budgetRepository.findById(deptId);
            
            BigDecimal available = budget.getTotalAmount()
                .subtract(budget.getSpentAmount())
                .subtract(budget.getReservedAmount());
            
            if (available.compareTo(amount) < 0) {
                return ReservationResult.insufficient();
            }
            
            budget.setReservedAmount(
                budget.getReservedAmount().add(amount)
            );
            budgetRepository.save(budget);
            
            return ReservationResult.success();
            
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ServiceException("Lock interrupted");
        } finally {
            lock.unlock();  // Always release
        }
    }
}
```

---

### 4.7 Duplicate Request Handling

**Q8: How do you handle duplicate request from same user at backend?**

**Answer: Idempotency keys stored in Redis.**

**Idempotency Pattern:**

```
┌────────────────────────────────────────────────────────────────────┐
│                    IDEMPOTENCY KEY PATTERN                          │
└────────────────────────────────────────────────────────────────────┘

CLIENT generates unique key (UUID):
  idempotencyKey = "550e8400-e29b-41d4-a716-446655440000"

REQUEST 1 (t=0s):
  POST /api/purchase-requests
  Header: X-Idempotency-Key: 550e8400...
  
  Server:
  1. Check Redis: key "request:idempotency:550e8400"
  2. Not found → Process request
  3. Store in Redis with 24hr TTL
  4. Return: 201 Created { id: "req-123", ... }
  
REQUEST 2 (t=1s, user clicked twice):
  POST /api/purchase-requests
  Header: X-Idempotency-Key: 550e8400... (SAME KEY)
  
  Server:
  1. Check Redis: key "request:idempotency:550e8400"
  2. FOUND → Return cached response
  3. Return: 200 OK { id: "req-123", ... } (SAME RESPONSE)
  
✅ Request processed only once, but client gets response both times
```

**Implementation:**

```java
// Idempotency Interceptor (Spring Boot)

@Component
public class IdempotencyInterceptor implements HandlerInterceptor {
    
    @Autowired
    private RedisTemplate<String, String> redisTemplate;
    
    @Override
    public boolean preHandle(
        HttpServletRequest request,
        HttpServletResponse response,
        Object handler
    ) throws Exception {
        
        String idempotencyKey = request.getHeader("X-Idempotency-Key");
        
        if (idempotencyKey == null) {
            // No idempotency key provided - proceed normally
            return true;
        }
        
        String redisKey = "request:idempotency:" + idempotencyKey;
        
        // Check if we've seen this key before
        String cachedResponse = redisTemplate.opsForValue().get(redisKey);
        
        if (cachedResponse != null) {
            // Duplicate request - return cached response
            response.setStatus(200);
            response.setContentType("application/json");
            response.getWriter().write(cachedResponse);
            return false;  // Stop processing
        }
        
        // First time seeing this key - proceed
        request.setAttribute("idempotencyKey", idempotencyKey);
        return true;
    }
}

// Controller

@RestController
@RequestMapping("/api/purchase-requests")
public class PurchaseRequestController {
    
    @Autowired
    private PurchaseRequestService service;
    
    @Autowired
    private RedisTemplate<String, String> redisTemplate;
    
    @PostMapping
    public ResponseEntity<?> createRequest(
        @RequestBody CreateRequestDto dto,
        @RequestAttribute(required = false) String idempotencyKey
    ) {
        // Process request
        PurchaseRequest request = service.createRequest(dto);
        
        // Cache response if idempotency key provided
        if (idempotencyKey != null) {
            String redisKey = "request:idempotency:" + idempotencyKey;
            String responseJson = objectMapper.writeValueAsString(request);
            
            // Store for 24 hours
            redisTemplate.opsForValue().set(
                redisKey,
                responseJson,
                Duration.ofHours(24)
            );
        }
        
        return ResponseEntity.status(201).body(request);
    }
}
```

**TTL Strategy:**

```
REDIS KEY EXPIRY:
- Idempotency keys: 24 hours
  (User won't retry after 1 day)
  
- Session data: 30 minutes
  (User session timeout)
  
- Cache data: 5-60 minutes
  (Depends on data freshness needs)
  
- Distributed locks: 10 seconds
  (Failsafe if process crashes)
```

**Library Recommendation:**

Use **Stripe's idempotency-key pattern** - it's the industry standard.

Or use existing library:

```xml
<!-- Spring Boot -->
<dependency>
    <groupId>com.stripe</groupId>
    <artifactId>stripe-java</artifactId>
    <version>23.0.0</version>
</dependency>

<!-- Or custom implementation -->
```

**Client-Side Generation:**

```typescript
// Frontend - React

import { v4 as uuidv4 } from 'uuid';

async function submitPurchaseRequest(data) {
  const idempotencyKey = uuidv4();
  
  const response = await fetch('/api/purchase-requests', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idempotencyKey,  // <-- KEY
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });
  
  return response.json();
}

// Even if button clicked twice, only one request processed
```

**Verdict: Use Redis-based idempotency keys with 24-hour TTL, following Stripe's pattern.**

---

### 4.8 Synchronous vs Asynchronous Communication

**Q9: Do you have scenarios where microservices communicate synchronously through API?**

**Answer: YES, for immediate consistency needs.**

**Communication Patterns:**

```
┌────────────────────────────────────────────────────────────────────┐
│              SYNCHRONOUS vs ASYNCHRONOUS                            │
└────────────────────────────────────────────────────────────────────┘

SYNCHRONOUS (REST API):
  ✅ Immediate response needed
  ✅ Strong consistency required
  ✅ User waiting for result
  
  User → Service A ──REST──> Service B
                    ←──────┘
         (blocks waiting)

ASYNCHRONOUS (Kafka Events):
  ✅ Can wait for result
  ✅ Eventual consistency OK
  ✅ Decoupled services
  
  User → Service A ──Event──> Kafka ──Event──> Service B
           ↓                              ↓
      Returns                         Processes
     immediately                       later
```

**SCENARIO 1: Check Budget (SYNCHRONOUS)**

```
When user creates purchase request:
  
REQUISITION SERVICE needs to know RIGHT NOW if budget exists.
User is waiting on the screen.

┌──────────────┐     GET /budget/check      ┌──────────────┐
│ Requisition  │───────────────────────────►│    Budget    │
│   Service    │                            │   Service    │
│              │◄───────────────────────────│              │
└──────────────┘   { available: 10000 }     └──────────────┘
      │
      │ If sufficient: Save request
      │ If insufficient: Return error to user immediately
      ▼
   Response to user (3 seconds later)
```

**Code:**

```java
// Requisition Service

@Service
public class PurchaseRequestService {
    
    @Autowired
    private RestTemplate restTemplate;  // Or WebClient, Feign
    
    @Value("${budget-service.url}")
    private String budgetServiceUrl;
    
    public PurchaseRequest createRequest(CreateRequestDto dto) {
        // 1. SYNCHRONOUS call to Budget Service
        BudgetCheckResponse budgetCheck = restTemplate.getForObject(
            budgetServiceUrl + "/api/budgets/check?deptId=" + dto.getDepartmentId() 
                             + "&amount=" + dto.getTotalAmount(),
            BudgetCheckResponse.class
        );
        
        if (!budgetCheck.isSufficient()) {
            // IMMEDIATE feedback to user
            throw new InsufficientBudgetException(
                "Available: " + budgetCheck.getAvailable() 
                + ", Required: " + dto.getTotalAmount()
            );
        }
        
        // 2. Budget OK - save request
        PurchaseRequest request = new PurchaseRequest();
        request.setStatus(RequestStatus.DRAFT);
        request.setTotalAmount(dto.getTotalAmount());
        
        return requestRepository.save(request);
    }
}
```

**SCENARIO 2: Get User Details (SYNCHRONOUS)**

```
When displaying purchase request:
  
┌──────────────┐     GET /users/123         ┌──────────────┐
│ Requisition  │───────────────────────────►│     User     │
│   Service    │                            │   Service    │
│              │◄───────────────────────────│              │
└──────────────┘   { name: "John Doe" }     └──────────────┘

Need user name RIGHT NOW to display on screen.
```

**SCENARIO 3: Request Approval Top-Up (SYNCHRONOUS)**

```
┌──────────────┐    POST /top-up/request    ┌──────────────┐
│ Requisition  │───────────────────────────►│    Budget    │
│   Service    │                            │   Service    │
│              │◄───────────────────────────│              │
└──────────────┘   { requestId: "..." }     └──────────────┘

User requests budget top-up, needs confirmation immediately.
```

**SCENARIO 4: Approval Workflow (ASYNCHRONOUS)**

```
┌──────────────┐      Event: Approved       ┌──────────────┐
│ Requisition  │───────────────────────────►│    KAFKA     │
│   Service    │                            │              │
└──────────────┘                            └──────┬───────┘
      │                                            │
      │                                            │
      │ Return to user: "Approved"                 │
      ▼                                            ▼
   (User sees                            ┌──────────────┐
    success msg)                         │    Vendor    │
                                         │   Service    │
                                         │              │
                                         └──────────────┘
                                         Sends RFQ later
```

**Synchronous API Usage Summary:**

| Scenario | Requester | Target | Reason |
|----------|-----------|--------|--------|
| Check budget | Requisition | Budget | Immediate validation |
| Get user details | Any | User | Display data |
| Verify vendor exists | Requisition | Vendor | Validation |
| Get approval chain | Requisition | User | Determine approvers |
| Request budget top-up | Requisition | Budget | User waiting |

**Why Synchronous Here:**

1. **User is waiting** - need immediate response
2. **Validation before save** - prevent invalid data
3. **Display data** - show on screen now
4. **Decision making** - determine next step

**Resilience Patterns:**

```java
// Use circuit breaker for synchronous calls

@Service
public class PurchaseRequestService {
    
    @CircuitBreaker(name = "budget-service", fallbackMethod = "checkBudgetFallback")
    public BudgetCheckResponse checkBudget(UUID deptId, BigDecimal amount) {
        return restTemplate.getForObject(
            budgetServiceUrl + "/api/budgets/check",
            BudgetCheckResponse.class
        );
    }
    
    // Fallback if Budget Service is down
    public BudgetCheckResponse checkBudgetFallback(
        UUID deptId, 
        BigDecimal amount, 
        Exception e
    ) {
        // Log error
        log.error("Budget service unavailable", e);
        
        // Return conservative response
        return BudgetCheckResponse.builder()
            .sufficient(false)
            .error("Budget service unavailable. Please try again later.")
            .build();
    }
}
```

**Verdict: YES, we use synchronous REST APIs for immediate validation/data needs. Async events for workflows.**

---

### 4.9 RabbitMQ Suitability

**Q10: Can I replace Kafka with RabbitMQ if I want?**

**Answer: YES, but with trade-offs. Requires architectural adjustments.**

**What Needs to Change:**

```
┌────────────────────────────────────────────────────────────────────┐
│              KAFKA → RABBITMQ MIGRATION                             │
└────────────────────────────────────────────────────────────────────┘

COMPONENT           KAFKA              RABBITMQ            CHANGE NEEDED
────────────────────────────────────────────────────────────────────────
Event bus           Kafka topics       Exchanges/Queues    ✅ Easy
Message retention   Permanent          Deleted after       ❌ Must change
Audit trail         Built-in           Needs workaround    ❌ Complex
Multiple consumers  Easy               Fanout exchange     ✅ Easy
Replay events       Yes                No                  ❌ Workaround
Order guarantee     Yes                Yes                 ✅ Same
```

**Architecture Changes:**

**BEFORE (Kafka):**

```
┌──────────────┐     Event      ┌───────────┐
│ Requisition  │───────────────►│   KAFKA   │
│   Service    │                │   Topic   │
└──────────────┘                └─────┬─────┘
                                      │
                        ┌─────────────┼─────────────┐
                        │             │             │
                  ┌─────▼────┐  ┌─────▼────┐  ┌────▼──────┐
                  │  Audit   │  │  Notify  │  │  Vendor   │
                  │ Consumer │  │ Consumer │  │  Consumer │
                  └──────────┘  └──────────┘  └───────────┘
                  All read same event
```

**AFTER (RabbitMQ):**

```
┌──────────────┐     Event      ┌─────────────────┐
│ Requisition  │───────────────►│   RABBITMQ      │
│   Service    │                │ Fanout Exchange │
└──────────────┘                └────────┬────────┘
                                         │
                      ┌──────────────────┼──────────────────┐
                      │                  │                  │
                ┌─────▼────┐      ┌──────▼─────┐    ┌──────▼─────┐
                │  Audit   │      │   Notify   │    │   Vendor   │
                │  Queue   │      │   Queue    │    │   Queue    │
                └─────┬────┘      └─────┬──────┘    └─────┬──────┘
                      │                 │                  │
                ┌─────▼────┐      ┌─────▼────┐      ┌─────▼────┐
                │  Audit   │      │  Notify  │      │  Vendor  │
                │ Consumer │      │ Consumer │      │ Consumer │
                └──────────┘      └──────────┘      └──────────┘
```

**Key Changes:**

1. **Audit Trail - Must Store Separately**

```java
// With Kafka: Events naturally stored
// With RabbitMQ: Must save to database or Elasticsearch

@Component
public class AuditConsumer {
    
    @Autowired
    private ElasticsearchRepository auditRepo;
    
    @RabbitListener(queues = "audit-queue")
    public void handleEvent(Event event) {
        // Save to Elasticsearch IMMEDIATELY
        // Because RabbitMQ will delete message after ACK
        auditRepo.save(event);
    }
}
```

2. **Event Replay - Not Possible**

```
KAFKA:  Can re-read messages from offset 0
        Useful for: rebuilding state, replaying failed events

RABBITMQ: Messages deleted after consumed
          Workaround: Store in database first, then publish
```

3. **Multiple Consumers - Use Fanout Exchange**

```java
@Configuration
public class RabbitMQConfig {
    
    @Bean
    public FanoutExchange eventExchange() {
        return new FanoutExchange("procurement.events");
    }
    
    @Bean
    public Queue auditQueue() {
        return new Queue("audit-queue");
    }
    
    @Bean
    public Queue notifyQueue() {
        return new Queue("notify-queue");
    }
    
    @Bean
    public Queue vendorQueue() {
        return new Queue("vendor-queue");
    }
    
    @Bean
    public Binding auditBinding() {
        return BindingBuilder
            .bind(auditQueue())
            .to(eventExchange());
    }
    
    @Bean
    public Binding notifyBinding() {
        return BindingBuilder
            .bind(notifyQueue())
            .to(eventExchange());
    }
    
    @Bean
    public Binding vendorBinding() {
        return BindingBuilder
            .bind(vendorQueue())
            .to(eventExchange());
    }
}
```

**Pros of RabbitMQ:**

✅ Simpler to understand (traditional queue)  
✅ Better for request/reply patterns  
✅ Easier local development  
✅ Lower resource usage  
✅ Mature Spring Boot integration

**Cons for This System:**

❌ No built-in event replay (bad for audit)  
❌ Messages deleted after consumption  
❌ More complex routing (exchanges/queues)  
❌ Need separate audit storage immediately  

**Verdict: You CAN use RabbitMQ, but Kafka is better for this procurement system due to audit requirements. If you go RabbitMQ, ensure events are saved to Elasticsearch BEFORE acknowledging.**

---

### 4.10 Redis Replication & Idempotency Details

**Q11: Do you have replicate set for Redis? Idempotency key library? TTL?**

**Answer: YES to Redis replication. Details below.**

**Redis Cluster Setup:**

```yaml
# Production Redis - Sentinel Mode (HA)

# docker-compose-redis.yml
version: '3.8'

services:
  redis-master:
    image: redis:7-alpine
    container_name: redis-master
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    ports:
      - "6379:6379"
    volumes:
      - redis-master-data:/data

  redis-replica-1:
    image: redis:7-alpine
    container_name: redis-replica-1
    command: >
      redis-server 
      --appendonly yes 
      --replicaof redis-master 6379
      --masterauth ${REDIS_PASSWORD}
      --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis-replica1-data:/data
    depends_on:
      - redis-master

  redis-replica-2:
    image: redis:7-alpine
    container_name: redis-replica-2
    command: >
      redis-server 
      --appendonly yes 
      --replicaof redis-master 6379
      --masterauth ${REDIS_PASSWORD}
      --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis-replica2-data:/data
    depends_on:
      - redis-master

  redis-sentinel-1:
    image: redis:7-alpine
    container_name: redis-sentinel-1
    command: redis-sentinel /etc/redis/sentinel.conf
    volumes:
      - ./sentinel.conf:/etc/redis/sentinel.conf
    depends_on:
      - redis-master

volumes:
  redis-master-data:
  redis-replica1-data:
  redis-replica2-data:
```

**Sentinel Configuration:**

```conf
# sentinel.conf

port 26379
sentinel monitor procurement-redis redis-master 6379 2
sentinel down-after-milliseconds procurement-redis 5000
sentinel parallel-syncs procurement-redis 1
sentinel failover-timeout procurement-redis 10000
```

**How Replication Works:**

```
┌────────────────────────────────────────────────────────────────────┐
│                    REDIS REPLICATION                                │
└────────────────────────────────────────────────────────────────────┘

                    ┌────────────────┐
                    │  REDIS MASTER  │
                    │  (Read/Write)  │
                    └───────┬────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
              ▼                           ▼
    ┌─────────────────┐         ┌─────────────────┐
    │ REPLICA 1       │         │ REPLICA 2       │
    │ (Read-only)     │         │ (Read-only)     │
    └─────────────────┘         └─────────────────┘

Writes: Always go to MASTER
Reads: Can go to MASTER or REPLICAS (configurable)

Replication: Async (eventual consistency)
Failover: Automatic via Sentinel
```

**Data Sync:**

```
1. Client writes to MASTER
   SET budget:lock:dept-123 "locked" EX 10

2. MASTER acknowledges immediately
   OK

3. MASTER replicates to REPLICAS (async)
   - Usually < 100ms
   - If replica is down, queued

4. REPLICA 1 receives: budget:lock:dept-123
   REPLICA 2 receives: budget:lock:dept-123
```

**Failover:**

```
NORMAL:
  App ──> Master (active)
          Replica 1 (standby)
          Replica 2 (standby)

MASTER FAILS:
  App ──X─> Master (down)
         Sentinel detects failure (5s)
         Promotes Replica 1 → new Master
         
NEW STATE:
  App ──> Replica 1 (now Master)
          Replica 2 (now replicates from Replica 1)
          Old Master (down or rejoins as replica)
```

**Spring Boot Configuration:**

```yaml
# application.yml

spring:
  redis:
    sentinel:
      master: procurement-redis
      nodes:
        - redis-sentinel-1:26379
        - redis-sentinel-2:26379
        - redis-sentinel-3:26379
    password: ${REDIS_PASSWORD}
    database: 0
    timeout: 2000ms
    lettuce:
      pool:
        max-active: 20
        max-idle: 10
        min-idle: 5
```

**Idempotency Library Recommendation:**

**OPTION 1: Spring Idempotent Requests (Custom)**

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface Idempotent {
    int ttlHours() default 24;
}

@Aspect
@Component
public class IdempotencyAspect {
    
    @Autowired
    private RedisTemplate<String, String> redis;
    
    @Around("@annotation(idempotent)")
    public Object handleIdempotency(
        ProceedingJoinPoint joinPoint, 
        Idempotent idempotent
    ) throws Throwable {
        
        HttpServletRequest request = 
            ((ServletRequestAttributes) RequestContextHolder
                .currentRequestAttributes())
                .getRequest();
        
        String key = request.getHeader("X-Idempotency-Key");
        
        if (key == null) {
            return joinPoint.proceed();
        }
        
        String redisKey = "idempotency:" + key;
        String cached = redis.opsForValue().get(redisKey);
        
        if (cached != null) {
            return objectMapper.readValue(cached, 
                joinPoint.getSignature().getDeclaringType());
        }
        
        Object result = joinPoint.proceed();
        
        redis.opsForValue().set(
            redisKey, 
            objectMapper.writeValueAsString(result),
            Duration.ofHours(idempotent.ttlHours())
        );
        
        return result;
    }
}

// Usage:
@PostMapping
@Idempotent(ttlHours = 24)
public ResponseEntity<?> createRequest(@RequestBody CreateRequestDto dto) {
    // ...
}
```

**OPTION 2: Stripe-Java SDK Pattern**

```java
// Use Stripe's proven pattern

import com.stripe.net.IdempotencyKey;

@Service
public class PurchaseRequestService {
    
    @Autowired
    private RedisTemplate<String, CachedResponse> redis;
    
    public PurchaseRequest createRequest(
        CreateRequestDto dto, 
        String idempotencyKey
    ) {
        String redisKey = "request:idempotency:" + idempotencyKey;
        
        // Try to get cached response
        CachedResponse cached = redis.opsForValue().get(redisKey);
        if (cached != null) {
            return cached.getResponse();
        }
        
        // First time - process
        PurchaseRequest request = processRequest(dto);
        
        // Cache for 24 hours
        CachedResponse toCache = CachedResponse.builder()
            .response(request)
            .createdAt(Instant.now())
            .build();
        
        redis.opsForValue().set(
            redisKey, 
            toCache, 
            Duration.ofHours(24)
        );
        
        return request;
    }
}
```

**OPTION 3: Resilience4j (if already using for circuit breaker)**

```xml
<dependency>
    <groupId>io.github.resilience4j</groupId>
    <artifactId>resilience4j-spring-boot3</artifactId>
    <version>2.1.0</version>
</dependency>
```

```java
// Combine with circuit breaker, retry, rate limiter
@Retry(name = "budget-service")
@CircuitBreaker(name = "budget-service")
public BudgetCheckResponse checkBudget(UUID deptId, BigDecimal amount) {
    // ...
}
```

**TTL Strategy:**

```
REDIS KEY TYPES & TTL:

1. Idempotency Keys
   Key: request:idempotency:{uuid}
   TTL: 24 hours
   Reason: User won't retry after 1 day
   
2. Session Data
   Key: user:session:{userId}
   TTL: 30 minutes
   Reason: Session timeout
   
3. Distributed Locks
   Key: budget:lock:{deptId}
   TTL: 10 seconds
   Reason: Failsafe if process crashes mid-transaction
   
4. Cache (User Details)
   Key: user:cache:{userId}
   TTL: 5 minutes
   Reason: User data changes infrequently
   
5. Cache (Budget Balance)
   Key: budget:cache:{deptId}
   TTL: 1 minute
   Reason: Balance changes frequently
   
6. Rate Limiting
   Key: ratelimit:{userId}:{endpoint}
   TTL: 1 minute (sliding window)
   Reason: Rate limit per minute
```

**Code Example - Different TTLs:**

```java
@Service
public class CacheService {
    
    @Autowired
    private RedisTemplate<String, Object> redis;
    
    // Idempotency - 24 hours
    public void cacheIdempotentResponse(String key, Object response) {
        redis.opsForValue().set(
            "idempotency:" + key,
            response,
            Duration.ofHours(24)
        );
    }
    
    // Session - 30 minutes
    public void cacheSession(String userId, SessionData data) {
        redis.opsForValue().set(
            "session:" + userId,
            data,
            Duration.ofMinutes(30)
        );
    }
    
    // Lock - 10 seconds
    public boolean acquireLock(String resourceId) {
        return Boolean.TRUE.equals(
            redis.opsForValue().setIfAbsent(
                "lock:" + resourceId,
                "locked",
                Duration.ofSeconds(10)
            )
        );
    }
    
    // User cache - 5 minutes
    public void cacheUser(UUID userId, User user) {
        redis.opsForValue().set(
            "user:" + userId,
            user,
            Duration.ofMinutes(5)
        );
    }
    
    // Budget cache - 1 minute (changes frequently)
    public void cacheBudget(UUID deptId, BudgetBalance balance) {
        redis.opsForValue().set(
            "budget:" + deptId,
            balance,
            Duration.ofMinutes(1)
        );
    }
}
```

**Verdict:**

✅ **Redis Replication:** YES - Master + 2 Replicas with Sentinel for automatic failover  
✅ **Idempotency Library:** Build custom using Spring AOP (200 lines) or follow Stripe pattern  
✅ **TTL:** 24 hours for idempotency, varies by use case (see table above)  
✅ **Sync:** Async replication (< 100ms lag), eventual consistency acceptable for cache

---

## 5. Summary Table - All Client Questions

| # | Question | Answer |
|---|----------|--------|
| 1 | RabbitMQ vs Kafka? | Kafka recommended (audit trail, replay) |
| 2 | Need notification microservice? | YES - simple consumer (~200 lines) |
| 3 | How prevent race condition? | @Transactional + DB row locks (FOR UPDATE) |
| 4 | Distributed transactions? | NO - use Saga pattern with events |
| 5 | Store PDFs where? | MinIO (S3-compatible object storage) |
| 6 | Which service handles invoice submission? | ORDER & PAYMENT SERVICE via token link |
| 7 | Redis per service? | ONE shared Redis, keyspace prefixes |
| 8 | Handle duplicate requests? | Idempotency keys in Redis (24hr TTL) |
| 9 | Synchronous API calls? | YES for validation/immediate data needs |
| 10 | Replace Kafka with RabbitMQ? | YES but requires audit storage workaround |
| 11 | Redis replication? | YES - Master + 2 Replicas + Sentinel |

---

*Document Version: 1.2*  
*Updated: January 27, 2026*  
*Added: Client Q&A Section 4*
