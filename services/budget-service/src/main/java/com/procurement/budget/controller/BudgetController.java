package com.procurement.budget.controller;

import com.procurement.budget.dto.BudgetAvailabilityResponse;
import com.procurement.budget.service.BudgetService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/budgets")
@RequiredArgsConstructor
@Slf4j
public class BudgetController {

    private final BudgetService budgetService;

    /**
     * Health check endpoint
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> response = new HashMap<>();
        response.put("status", "healthy");
        response.put("service", "budget-service");
        response.put("timestamp", System.currentTimeMillis());
        return ResponseEntity.ok(response);
    }

    /**
     * Get available budget for a department
     * GET /api/v1/budgets/{departmentId}/available
     */
    @GetMapping("/{departmentId}/available")
    public ResponseEntity<BudgetAvailabilityResponse> getAvailableBudget(
            @PathVariable String departmentId) {
        
        log.info("Received request for budget availability: {}", departmentId);
        
        try {
            BudgetAvailabilityResponse response = budgetService.getAvailableBudget(departmentId);
            return ResponseEntity.ok(response);
        } catch (RuntimeException e) {
            log.error("Error fetching budget for department: {}", departmentId, e);
            throw e;
        }
    }
}
