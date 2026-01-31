package com.procurement.budget.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "departments")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Department {

    @Id
    @Column(name = "id", length = 50)
    private String id;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "total_budget", nullable = false, precision = 15, scale = 2)
    private BigDecimal totalBudget = BigDecimal.ZERO;

    @Column(name = "used_budget", nullable = false, precision = 15, scale = 2)
    private BigDecimal usedBudget = BigDecimal.ZERO;

    @Column(name = "reserved_budget", nullable = false, precision = 15, scale = 2)
    private BigDecimal reservedBudget = BigDecimal.ZERO;

    @Column(name = "fiscal_year", nullable = false)
    private Integer fiscalYear;

    @Column(name = "currency", length = 3)
    private String currency = "USD";

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }

    /**
     * Calculate available budget
     * Available = Total - Used - Reserved
     */
    public BigDecimal getAvailableBudget() {
        return totalBudget
                .subtract(usedBudget)
                .subtract(reservedBudget);
    }
}
