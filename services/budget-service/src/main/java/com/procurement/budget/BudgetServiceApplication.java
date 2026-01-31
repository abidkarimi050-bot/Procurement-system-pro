package com.procurement.budget;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class BudgetServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(BudgetServiceApplication.class, args);
        System.out.println("""
            
            ╔══════════════════════════════════════╗
            ║   💰 Budget Service Started!         ║
            ║   Port: 8080                         ║
            ║   Endpoint: /api/v1/budgets          ║
            ╚══════════════════════════════════════╝
            """);
    }
}
