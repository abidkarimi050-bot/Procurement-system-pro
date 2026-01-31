package com.procurement.budget.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class KafkaProducerService {

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Send event to Kafka topic
     */
    public void sendEvent(String topic, Map<String, Object> event) {
        try {
            String eventJson = objectMapper.writeValueAsString(event);
            kafkaTemplate.send(topic, eventJson);
            log.debug("Event sent to Kafka topic {}: {}", topic, event.get("eventType"));
        } catch (Exception e) {
            log.error("Failed to send event to Kafka topic: {}", topic, e);
            throw new RuntimeException("Failed to send Kafka event", e);
        }
    }
}
