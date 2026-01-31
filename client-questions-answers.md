# Client Questions & Answers - Deep Dive

This document addresses specific client questions about the Procurement System architecture, providing detailed explanations and code examples.

---

## Table of Contents

1. [RabbitMQ vs Kafka - Which One to Use?](#1-rabbitmq-vs-kafka---which-one-to-use)
2. [Notification Microservice Requirement](#2-notification-microservice-requirement)
3. [Race Conditions & Database Locks](#3-race-conditions--database-locks)
4. [Distributed Transactions](#4-distributed-transactions)
5. [File Storage for PDFs](#5-file-storage-for-pdfs)
6. [Vendor Invoice Submission](#6-vendor-invoice-submission)
7. [Redis Architecture](#7-redis-architecture)
8. [Duplicate Request Handling](#8-duplicate-request-handling)
9. [Synchronous vs Asynchronous Communication](#9-synchronous-vs-asynchronous-communication)
10. [RabbitMQ Suitability](#10-rabbitmq-suitability)
11. [Redis Replication & Idempotency Details](#11-redis-replication--idempotency-details)

---

## 1. RabbitMQ vs Kafka - Which One to Use?

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

## 2. Notification Microservice Requirement

**Q2: It seems like we need a notification microservice to read from Kafka for sending email as well?**

**Answer: YES, you need a consumer (can be simple).**

### Options:

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

### Recommended Architecture:

```
┌──────────────┐      ┌────────────┐      ┌─────────────────┐      ┌──────┐
│ Requisition  │─────►│   KAFKA    │─────►│  Notification   │─────►│ SMTP │
│   Service    │      │   Topic    │      │     Worker      │      │      │
└──────────────┘      └────────────┘      └─────────────────┘      └──────┘
     Produces              Stores              Consumes              Sends
   notification          messages            + formats HTML
     events
```

### Simple Notification Worker Code:

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

## 3. Race Conditions & Database Locks

**Q3: How does Spring Boot @Transactional + DB locks prevents race condition (two requests checking same budget)?**

**Answer: Using pessimistic locking to prevent concurrent budget checks.**

### THE PROBLEM:

```
TIME    REQUEST A                    REQUEST B
t0      Check budget: $10,000 available
t1                                   Check budget: $10,000 available
t2      Reserve $8,000 (balance = $2,000)
t3                                   Reserve $8,000 (ERROR: overdraft!)
t4      ❌ PROBLEM: Both saw $10,000, but only $10,000 exists
```

### THE SOLUTION: Database Row Locking

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

### Repository with Locking:

```java
public interface BudgetRepository extends JpaRepository<DepartmentBudget, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT b FROM DepartmentBudget b WHERE b.departmentId = :deptId")
    DepartmentBudget findByDepartmentIdWithLock(@Param("deptId") UUID deptId);
}
```

### What Happens with Lock:

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

### Key Points:

1. **FOR UPDATE** locks the row - no other transaction can modify it
2. Request B waits until Request A completes
3. When Request B runs, it sees the updated balance ($2,000)
4. Race condition prevented ✅

### Alternative: Optimistic Locking

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

## 4. Distributed Transactions

**Q4: In what scenarios will REQUISITION SERVICE need to coordinate with BUDGET SERVICE for distributed transaction?**

**Answer: Distributed transactions are NOT used. We use event-driven choreography instead.**

### Why NOT Distributed Transactions (2PC)?

```
PROBLEMS WITH 2-PHASE COMMIT:
❌ Slow (multiple round trips)
❌ Locks held across services (blocking)
❌ If Budget Service is down, Requisition Service blocks
❌ Complex failure scenarios
❌ Not cloud-native pattern
```

### Our Approach: Event-Driven Saga Pattern

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

### Code Example:

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

### SCENARIO 2: Create Purchase Order (Reserve Budget)

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

### Compensation (Rollback)

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

### Key Points:

1. **No distributed transactions** - each service has its own transaction
2. **Eventually consistent** - takes time for saga to complete
3. **Resilient** - if Budget Service is down, events wait in Kafka
4. **Compensating actions** - undo operations if needed

---

## 5. File Storage for PDFs

**Q5: I also want to store quotation pdf, invoice pdf, where should I store them?**

**Answer: Use MinIO (S3-compatible) object storage.**

### Storage Architecture:

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

### Database Schema (Already Defined):

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

### File Upload Flow:

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

### MinIO Service:

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

### File Organization:

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

### Why MinIO over Local Filesystem:

| Feature | MinIO | Local Filesystem |
|---------|-------|------------------|
| Scalability | Distributed, unlimited | Limited by disk |
| Availability | Replicated | Single point of failure |
| Kubernetes-friendly | StatefulSet or external | Requires PersistentVolume |
| S3-compatible | Yes (easy migration) | No |
| Access control | IAM policies | File permissions |
| Backup | Built-in | Manual |

### Production Setup:

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

## 6. Vendor Invoice Submission

**Q6: When the vendor sends us the invoice through a link provided by us, which microservice will handle the request?**

**Answer: ORDER & PAYMENT SERVICE handles invoice submission.**

### Invoice Submission Flow:

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

### API Endpoint:

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

### Generate Invoice Submission Link:

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

### Token Service:

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

### Email Template:

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

## 7. Redis Architecture

**Q7: Do you have a Redis for each microservice?**

**Answer: ONE shared Redis cluster, but each service uses its own keyspace.**

### Redis Architecture:

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

### Why Shared Redis:

| Aspect | Shared Redis | Per-Service Redis |
|--------|--------------|-------------------|
| Cost | 1 cluster | 5 clusters |
| Memory efficiency | Better (shared pool) | Waste (over-provisioned) |
| Operational overhead | Low (manage 1) | High (manage 5) |
| Network hops | Same | Same |
| Key collision risk | Use prefixes | None |
| Isolation | Keyspace isolation | Full isolation |

**Verdict: ONE shared Redis cluster with keyspace prefixes per service.**

### Redis Usage Patterns:

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

## 8. Duplicate Request Handling

**Q8: How do you handle duplicate request from same user at backend?**

**Answer: Idempotency keys stored in Redis.**

### Idempotency Pattern:

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

### Implementation:

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

### TTL Strategy:

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

### Library Recommendation:

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

### Client-Side Generation:

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

## 9. Synchronous vs Asynchronous Communication

**Q9: Do you have scenarios where microservices communicate synchronously through API?**

**Answer: YES, for immediate consistency needs.**

### Communication Patterns:

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

### SCENARIO 1: Check Budget (SYNCHRONOUS)

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

### Code:

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

### SCENARIO 2: Get User Details (SYNCHRONOUS)

```
When displaying purchase request:
  
┌──────────────┐     GET /users/123         ┌──────────────┐
│ Requisition  │───────────────────────────►│     User     │
│   Service    │                            │   Service    │
│              │◄───────────────────────────│              │
└──────────────┘   { name: "John Doe" }     └──────────────┘

Need user name RIGHT NOW to display on screen.
```

### SCENARIO 3: Request Approval Top-Up (SYNCHRONOUS)

```
┌──────────────┐    POST /top-up/request    ┌──────────────┐
│ Requisition  │───────────────────────────►│    Budget    │
│   Service    │                            │   Service    │
│              │◄───────────────────────────│              │
└──────────────┘   { requestId: "..." }     └──────────────┘

User requests budget top-up, needs confirmation immediately.
```

### SCENARIO 4: Approval Workflow (ASYNCHRONOUS)

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

### Synchronous API Usage Summary:

| Scenario | Requester | Target | Reason |
|----------|-----------|--------|--------|
| Check budget | Requisition | Budget | Immediate validation |
| Get user details | Any | User | Display data |
| Verify vendor exists | Requisition | Vendor | Validation |
| Get approval chain | Requisition | User | Determine approvers |
| Request budget top-up | Requisition | Budget | User waiting |

### Why Synchronous Here:

1. **User is waiting** - need immediate response
2. **Validation before save** - prevent invalid data
3. **Display data** - show on screen now
4. **Decision making** - determine next step

### Resilience Patterns:

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

## 10. RabbitMQ Suitability

**Q10: Can I replace Kafka with RabbitMQ if I want?**

**Answer: YES, but with trade-offs. Requires architectural adjustments.**

### What Needs to Change:

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

### Architecture Changes:

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

### Key Changes:

#### 1. Audit Trail - Must Store Separately

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

#### 2. Event Replay - Not Possible

```
KAFKA:  Can re-read messages from offset 0
        Useful for: rebuilding state, replaying failed events

RABBITMQ: Messages deleted after consumed
          Workaround: Store in database first, then publish
```

#### 3. Multiple Consumers - Use Fanout Exchange

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

### Pros of RabbitMQ:

✅ Simpler to understand (traditional queue)  
✅ Better for request/reply patterns  
✅ Easier local development  
✅ Lower resource usage  
✅ Mature Spring Boot integration

### Cons for This System:

❌ No built-in event replay (bad for audit)  
❌ Messages deleted after consumption  
❌ More complex routing (exchanges/queues)  
❌ Need separate audit storage immediately  

**Verdict: You CAN use RabbitMQ, but Kafka is better for this procurement system due to audit requirements. If you go RabbitMQ, ensure events are saved to Elasticsearch BEFORE acknowledging.**

---

## 11. Redis Replication & Idempotency Details

**Q11: Do you have replicate set for Redis? Idempotency key library? TTL?**

**Answer: YES to Redis replication. Details below.**

### Redis Cluster Setup:

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

### Sentinel Configuration:

```conf
# sentinel.conf

port 26379
sentinel monitor procurement-redis redis-master 6379 2
sentinel down-after-milliseconds procurement-redis 5000
sentinel parallel-syncs procurement-redis 1
sentinel failover-timeout procurement-redis 10000
```

### How Replication Works:

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

### Data Sync:

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

### Failover:

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

### Spring Boot Configuration:

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

### Idempotency Library Recommendation:

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

### TTL Strategy:

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

### Code Example - Different TTLs:

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

### Verdict:

✅ **Redis Replication:** YES - Master + 2 Replicas with Sentinel for automatic failover  
✅ **Idempotency Library:** Build custom using Spring AOP (200 lines) or follow Stripe pattern  
✅ **TTL:** 24 hours for idempotency, varies by use case (see table above)  
✅ **Sync:** Async replication (< 100ms lag), eventual consistency acceptable for cache

---

## Summary Table - All Client Questions

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

*Document Version: 1.0*  
*Created: January 28, 2026*  
*Questions from Client Q&A Session*
