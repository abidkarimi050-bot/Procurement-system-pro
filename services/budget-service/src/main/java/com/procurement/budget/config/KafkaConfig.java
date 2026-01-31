package com.procurement.budget.config;

import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;

@Configuration
public class KafkaConfig {

    /**
     * Create budget events topic
     */
    @Bean
    public NewTopic budgetEventsTopic() {
        return TopicBuilder.name("budget.events")
                .partitions(3)
                .replicas(1)
                .build();
    }
}
