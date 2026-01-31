package com.procurement.budget.service;

import com.procurement.budget.dto.BudgetAvailabilityResponse;
import com.procurement.budget.entity.Department;
import com.procurement.budget.kafka.KafkaProducerService;
import com.procurement.budget.repository.DepartmentRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class BudgetService {

    private final DepartmentRepository departmentRepository;
    private final KafkaProducerService kafkaProducerService;

    /**
     * Get available budget for a department in the current fiscal year
     */
    @Transactional(readOnly = true)
    public BudgetAvailabilityResponse getAvailableBudget(String departmentId) {
        log.info("Fetching budget availability for department: {}", departmentId);

        // Get current fiscal year
        int currentYear = LocalDateTime.now().getYear();

        // Find department
        Department department = departmentRepository.findByIdAndFiscalYear(departmentId, currentYear)
                .orElseThrow(() -> {
                    log.error("Department not found: {} for fiscal year: {}", departmentId, currentYear);
                    return new RuntimeException("Department not found: " + departmentId);
                });

        // Create response
        BudgetAvailabilityResponse response = BudgetAvailabilityResponse.from(department);

        // Publish audit event to Kafka
        publishBudgetQueryEvent(departmentId, response);

        log.info("Budget availability retrieved for {}: Available={}, Total={}", 
                departmentId, response.getAvailableBudget(), response.getTotalBudget());

        return response;
    }

    /**
     * Publish budget query event to Kafka for audit trail
     */
    private void publishBudgetQueryEvent(String departmentId, BudgetAvailabilityResponse response) {
        try {
            Map<String, Object> event = new HashMap<>();
            event.put("eventType", "BUDGET_QUERIED");
            event.put("departmentId", departmentId);
            event.put("availableBudget", response.getAvailableBudget());
            event.put("totalBudget", response.getTotalBudget());
            event.put("timestamp", LocalDateTime.now().toString());
            event.put("service", "budget-service");

            kafkaProducerService.sendEvent("budget.events", event);
            log.debug("Budget query event published to Kafka");
        } catch (Exception e) {
            // Don't fail the request if Kafka publish fails
            log.error("Failed to publish budget query event to Kafka", e);
        }
    }
}
