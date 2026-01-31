# Sorting Implementation Examples - All Services

This quick reference shows how to implement sorting for all 5 services.

---

## 1. Standard Sorting Rules (All Services)

### Format
```
sort=fieldName:direction
```

- **fieldName**: Column name (e.g., `createdAt`, `amount`, `status`)
- **direction**: `asc` or `desc` (default: `desc`)
- **Default**: `createdAt:desc` (newest first)

### Query Examples
```bash
# Sort by creation date (newest first) - DEFAULT
GET /api/v1/requisitions?sort=createdAt:desc

# Sort by amount (highest first)
GET /api/v1/budgets?sort=totalAllocatedAmount:desc

# Sort by name (A-Z)
GET /api/v1/vendors?sort=name:asc

# With pagination and filtering
GET /api/v1/requisitions?page=1&limit=20&sort=amount:desc&status=approved
```

---

## 2. Service-Specific Sortable Fields

### 🟢 User Service (NestJS)
**Sortable Fields:**
- `createdAt` - When user was created
- `updatedAt` - Last update
- `email` - Email address (alphabetical)
- `firstName` - First name (alphabetical)
- `lastName` - Last name (alphabetical)
- `departmentId` - Department

**Examples:**
```bash
GET /api/v1/users?sort=lastName:asc           # A-Z by last name
GET /api/v1/users?sort=createdAt:desc         # Newest users first
GET /api/v1/users?sort=email:asc              # Email alphabetical
GET /api/v1/departments?sort=name:asc         # Departments A-Z
```

**Implementation (NestJS + TypeORM):**
```typescript
// users.service.ts
async findAll(paginationDto: PaginationDto) {
  const { page, limit, sort, search } = paginationDto;
  
  const queryBuilder = this.userRepository.createQueryBuilder('user');
  
  if (search) {
    queryBuilder.where(
      'user.firstName ILIKE :search OR user.lastName ILIKE :search OR user.email ILIKE :search',
      { search: `%${search}%` }
    );
  }

  // Parse and apply sorting
  const [field, direction] = (sort || 'createdAt:desc').split(':');
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
```

---

### 🔵 Budget Service (Spring Boot)
**Sortable Fields:**
- `createdAt` - When budget was created
- `updatedAt` - Last update
- `totalAllocatedAmount` - Total budget amount (descending = largest first)
- `spentAmount` - Amount spent
- `reservedAmount` - Amount reserved
- `fiscalYear` - Fiscal year

**Examples:**
```bash
GET /api/v1/budgets?sort=totalAllocatedAmount:desc    # Largest budgets first
GET /api/v1/budgets?sort=createdAt:desc               # Newest first
GET /api/v1/budgets?sort=spentAmount:desc&status=active
GET /api/v1/budgets?sort=fiscalYear:desc              # Latest year first
```

**Implementation (Spring Boot + JPA):**
```java
// BudgetService.java
public Page<Budget> findAll(PaginationDto dto) {
    // Parse sort parameter
    String[] sortParts = dto.getSort().split(":");
    String field = sortParts[0];
    String direction = sortParts.length > 1 ? sortParts[1] : "desc";
    
    // Create sort object
    Sort sort = direction.equalsIgnoreCase("asc") 
        ? Sort.by(field).ascending() 
        : Sort.by(field).descending();
    
    // Create pageable with sorting
    Pageable pageable = PageRequest.of(dto.getPage() - 1, dto.getLimit(), sort);
    
    // Apply search if provided
    if (dto.getSearch() != null && !dto.getSearch().isEmpty()) {
        return budgetRepository.searchBudgets(dto.getSearch(), pageable);
    }
    
    return budgetRepository.findAll(pageable);
}

// BudgetRepository.java
@Repository
public interface BudgetRepository extends JpaRepository<Budget, UUID> {
    
    @Query("SELECT b FROM Budget b WHERE " +
           "CAST(b.fiscalYear AS string) LIKE %:search% OR " +
           "b.status LIKE %:search%")
    Page<Budget> searchBudgets(@Param("search") String search, Pageable pageable);
}
```

---

### 🟣 Requisition Service (Spring Boot)
**Sortable Fields:**
- `createdAt` - When request was created
- `updatedAt` - Last change
- `amount` - Request amount
- `status` - Approval status (alphabetical: approved < draft < pending < rejected)
- `priority` - Priority level
- `title` - Request title (alphabetical)

**Examples:**
```bash
GET /api/v1/requisitions?sort=amount:desc              # Highest amount first
GET /api/v1/requisitions?sort=createdAt:desc&page=1    # Newest first (paginated)
GET /api/v1/requisitions?sort=priority:asc             # Critical < High < Medium < Low
GET /api/v1/requisitions?sort=status:asc&status=pending # Sort pending by status
GET /api/v1/requisitions?sort=title:asc                # Alphabetical by title
```

**Implementation (Spring Boot + JPA):**
```java
// RequisitionService.java
public Page<PurchaseRequest> findAll(PaginationDto dto, String status) {
    String[] sortParts = dto.getSort().split(":");
    String field = sortParts[0];
    String direction = sortParts.length > 1 ? sortParts[1] : "desc";
    
    Sort sort = direction.equalsIgnoreCase("asc") 
        ? Sort.by(field).ascending() 
        : Sort.by(field).descending();
    
    Pageable pageable = PageRequest.of(dto.getPage() - 1, dto.getLimit(), sort);
    
    if (status != null && !status.isEmpty()) {
        return requestRepository.findByStatus(status, pageable);
    }
    
    if (dto.getSearch() != null && !dto.getSearch().isEmpty()) {
        return requestRepository.searchRequests(dto.getSearch(), pageable);
    }
    
    return requestRepository.findAll(pageable);
}

// RequisitionRepository.java
@Repository
public interface RequisitionRepository extends JpaRepository<PurchaseRequest, UUID> {
    
    Page<PurchaseRequest> findByStatus(String status, Pageable pageable);
    
    @Query("SELECT r FROM PurchaseRequest r WHERE " +
           "r.title LIKE %:search% OR " +
           "r.description LIKE %:search%")
    Page<PurchaseRequest> searchRequests(@Param("search") String search, Pageable pageable);
}
```

---

### 🟡 Vendor Service (NestJS)
**Sortable Fields:**
- `createdAt` - When vendor was added
- `name` - Vendor name (A-Z)
- `rating` - Star rating (1-5, highest first)
- `category` - Category (alphabetical)
- `status` - Vendor status

**Examples:**
```bash
GET /api/v1/vendors?sort=name:asc                   # A-Z
GET /api/v1/vendors?sort=rating:desc                # Highest rated first
GET /api/v1/vendors?sort=createdAt:desc             # Recently added first
GET /api/v1/vendors?sort=rating:desc&search=acme    # Top-rated "acme" vendors
GET /api/v1/vendors?sort=category:asc&status=active # Active vendors by category
```

**Implementation (NestJS + TypeORM):**
```typescript
// vendors.service.ts
async findAll(paginationDto: PaginationDto, filters?: VendorFilterDto) {
  const { page, limit, sort, search } = paginationDto;
  
  const queryBuilder = this.vendorRepository.createQueryBuilder('vendor');
  
  // Apply search
  if (search) {
    queryBuilder.where(
      'vendor.name ILIKE :search OR vendor.email ILIKE :search',
      { search: `%${search}%` }
    );
  }

  // Apply filters
  if (filters?.status) {
    queryBuilder.andWhere('vendor.status = :status', { status: filters.status });
  }

  if (filters?.category) {
    queryBuilder.andWhere('vendor.category = :category', { category: filters.category });
  }

  // Parse and apply sorting
  const [field, direction] = (sort || 'name:asc').split(':');
  queryBuilder.orderBy(`vendor.${field}`, direction.toUpperCase() as 'ASC' | 'DESC');

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

// Quotations sorting
async findQuotations(rfqId: string, paginationDto: PaginationDto) {
  const { page, limit, sort } = paginationDto;
  
  const queryBuilder = this.quotationRepository
    .createQueryBuilder('quotation')
    .where('quotation.rfqId = :rfqId', { rfqId })
    .leftJoinAndSelect('quotation.vendor', 'vendor');

  const [field, direction] = (sort || 'totalAmount:asc').split(':');
  queryBuilder.orderBy(`quotation.${field}`, direction.toUpperCase() as 'ASC' | 'DESC');

  const [data, total] = await queryBuilder
    .skip((page - 1) * limit)
    .take(limit)
    .getManyAndCount();

  return { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}
```

---

### 🔴 Order & Payment Service (Spring Boot)
**Sortable Fields:**
- `createdAt` - When order was placed
- `updatedAt` - Last update
- `orderDate` - Order date
- `totalAmount` - Order amount
- `status` - Order status
- `poNumber` - PO number (alphanumeric)

**Examples:**
```bash
GET /api/v1/orders?sort=createdAt:desc              # Newest orders first
GET /api/v1/orders?sort=totalAmount:desc            # Largest orders first
GET /api/v1/orders?sort=orderDate:desc&status=shipped
GET /api/v1/invoices?sort=dueDate:asc               # Invoices by due date (earliest first)
GET /api/v1/payments?sort=paymentDate:desc          # Recent payments first
```

**Implementation (Spring Boot + JPA):**
```java
// OrderService.java
public Page<PurchaseOrder> findAll(PaginationDto dto, String status) {
    String[] sortParts = dto.getSort().split(":");
    String field = sortParts[0];
    String direction = sortParts.length > 1 ? sortParts[1] : "desc";
    
    Sort sort = direction.equalsIgnoreCase("asc") 
        ? Sort.by(field).ascending() 
        : Sort.by(field).descending();
    
    Pageable pageable = PageRequest.of(dto.getPage() - 1, dto.getLimit(), sort);
    
    if (status != null && !status.isEmpty()) {
        return orderRepository.findByStatus(status, pageable);
    }
    
    if (dto.getSearch() != null && !dto.getSearch().isEmpty()) {
        return orderRepository.searchOrders(dto.getSearch(), pageable);
    }
    
    return orderRepository.findAll(pageable);
}

// InvoiceService.java
public Page<Invoice> findAll(PaginationDto dto) {
    String[] sortParts = dto.getSort().split(":");
    String field = sortParts[0];
    String direction = sortParts.length > 1 ? sortParts[1] : "desc";
    
    Sort sort = direction.equalsIgnoreCase("asc") 
        ? Sort.by(field).ascending() 
        : Sort.by(field).descending();
    
    Pageable pageable = PageRequest.of(dto.getPage() - 1, dto.getLimit(), sort);
    
    return invoiceRepository.findAll(pageable);
}

// OrderRepository.java
@Repository
public interface OrderRepository extends JpaRepository<PurchaseOrder, UUID> {
    
    Page<PurchaseOrder> findByStatus(String status, Pageable pageable);
    
    @Query("SELECT o FROM PurchaseOrder o WHERE " +
           "o.poNumber LIKE %:search% OR " +
           "CAST(o.totalAmount AS string) LIKE %:search%")
    Page<PurchaseOrder> searchOrders(@Param("search") String search, Pageable pageable);
}
```

---

## 3. Multi-Field Sorting (Advanced)

If needed, support multiple sort fields:

```bash
# Sort by status first, then by amount
GET /api/v1/requisitions?sort=status:asc,amount:desc
```

**NestJS Implementation:**
```typescript
async findAll(paginationDto: PaginationDto) {
  const { sort } = paginationDto;
  const queryBuilder = this.repository.createQueryBuilder('entity');
  
  // Parse multiple sorts: "status:asc,amount:desc"
  const sorts = sort.split(',');
  sorts.forEach((sortStr, index) => {
    const [field, direction] = sortStr.split(':');
    const orderFunc = index === 0 ? 'orderBy' : 'addOrderBy';
    queryBuilder[orderFunc](`entity.${field}`, direction.toUpperCase() as 'ASC' | 'DESC');
  });
  
  return await queryBuilder.getManyAndCount();
}
```

**Spring Boot Implementation:**
```java
public Page<Entity> findAll(PaginationDto dto) {
    // Parse multiple sorts: "status:asc,amount:desc"
    String[] sortSpecs = dto.getSort().split(",");
    
    List<Sort.Order> orders = new ArrayList<>();
    for (String spec : sortSpecs) {
        String[] parts = spec.split(":");
        String field = parts[0];
        String direction = parts.length > 1 ? parts[1] : "desc";
        
        orders.add(direction.equalsIgnoreCase("asc") 
            ? Sort.Order.asc(field) 
            : Sort.Order.desc(field));
    }
    
    Sort sort = Sort.by(orders);
    Pageable pageable = PageRequest.of(dto.getPage() - 1, dto.getLimit(), sort);
    
    return repository.findAll(pageable);
}
```

---

## 4. Controller Examples

### NestJS Controller
```typescript
// users.controller.ts
@Controller('api/v1/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async findAll(@Query() paginationDto: PaginationDto) {
    return this.usersService.findAll(paginationDto);
  }
}

// pagination.dto.ts
import { IsOptional, IsInt, Min, Max, IsString } from 'class-validator';
import { Type } from 'class-transformer';

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
```

### Spring Boot Controller
```java
// BudgetController.java
@RestController
@RequestMapping("/api/v1/budgets")
public class BudgetController {

    private final BudgetService budgetService;

    public BudgetController(BudgetService budgetService) {
        this.budgetService = budgetService;
    }

    @GetMapping
    public ResponseEntity<Page<Budget>> findAll(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(defaultValue = "createdAt:desc") String sort,
            @RequestParam(required = false) String search) {
        
        PaginationDto dto = new PaginationDto();
        dto.setPage(page);
        dto.setLimit(limit);
        dto.setSort(sort);
        dto.setSearch(search);
        
        Page<Budget> result = budgetService.findAll(dto);
        return ResponseEntity.ok(result);
    }
}

// PaginationDto.java
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

## 5. Testing Sorting

### Unit Test (NestJS - Jest)
```typescript
describe('UsersService - Sorting', () => {
  it('should sort users by lastName ascending', async () => {
    const dto = new PaginationDto();
    dto.sort = 'lastName:asc';
    
    const result = await service.findAll(dto);
    
    expect(result.data[0].lastName).toBeLessThanOrEqual(result.data[1].lastName);
  });

  it('should sort by createdAt descending by default', async () => {
    const result = await service.findAll(new PaginationDto());
    
    expect(result.data[0].createdAt).toBeGreaterThanOrEqual(result.data[1].createdAt);
  });
});
```

### Unit Test (Spring Boot - JUnit)
```java
@Test
public void testSortByAmountDescending() {
    PaginationDto dto = new PaginationDto();
    dto.setSort("totalAllocatedAmount:desc");
    
    Page<Budget> result = budgetService.findAll(dto);
    
    List<Budget> budgets = result.getContent();
    assertTrue(budgets.get(0).getTotalAllocatedAmount()
        .compareTo(budgets.get(1).getTotalAllocatedAmount()) >= 0);
}

@Test
public void testDefaultSorting() {
    PaginationDto dto = new PaginationDto();
    
    Page<Budget> result = budgetService.findAll(dto);
    
    List<Budget> budgets = result.getContent();
    assertTrue(budgets.get(0).getCreatedAt()
        .isAfter(budgets.get(1).getCreatedAt()) || 
        budgets.get(0).getCreatedAt().equals(budgets.get(1).getCreatedAt()));
}
```

---

## Summary Table

| Service | Default Sort | Most Common Sorts |
|---------|-------------|-------------------|
| **User Service** | `createdAt:desc` | `lastName:asc`, `email:asc` |
| **Budget Service** | `createdAt:desc` | `totalAllocatedAmount:desc`, `fiscalYear:desc` |
| **Requisition Service** | `createdAt:desc` | `amount:desc`, `priority:asc`, `status:asc` |
| **Vendor Service** | `name:asc` | `rating:desc`, `createdAt:desc` |
| **Order & Payment** | `createdAt:desc` | `totalAmount:desc`, `orderDate:desc`, `dueDate:asc` |

---

## Best Practices

✅ **Always provide a default sort** (`createdAt:desc`)  
✅ **Validate sortable fields** to prevent SQL injection  
✅ **Use indexes** on sortable columns for performance  
✅ **Document sortable fields** in API documentation  
✅ **Test sorting** with unit and integration tests  
✅ **Combine with pagination** for large datasets  
✅ **Consider performance** - avoid sorting on calculated fields without indexes
