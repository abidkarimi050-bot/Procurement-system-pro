package com.procurement.budget.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BudgetAvailabilityResponse {
    
    private String departmentId;
    private String departmentName;
    private BigDecimal totalBudget;
    private BigDecimal usedBudget;
    private BigDecimal reservedBudget;
    private BigDecimal availableBudget;
    private Integer fiscalYear;
    private String currency;
    private String status;
    
    public static BudgetAvailabilityResponse from(com.procurement.budget.entity.Department department) {
        return BudgetAvailabilityResponse.builder()
                .departmentId(department.getId())
                .departmentName(department.getName())
                .totalBudget(department.getTotalBudget())
                .usedBudget(department.getUsedBudget())
                .reservedBudget(department.getReservedBudget())
                .availableBudget(department.getAvailableBudget())
                .fiscalYear(department.getFiscalYear())
                .currency(department.getCurrency())
                .status(department.getAvailableBudget().compareTo(BigDecimal.ZERO) > 0 ? "available" : "depleted")
                .build();
    }
}
