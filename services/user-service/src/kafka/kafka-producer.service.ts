import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private kafka: Kafka;
  private producer: Producer;

  constructor() {
    this.kafka = new Kafka({
      clientId: process.env.KAFKA_CLIENT_ID || 'user-service',
      brokers: (process.env.KAFKA_BROKERS || 'kafka:29092').split(','),
    });
    this.producer = this.kafka.producer();
  }

  async onModuleInit() {
    await this.producer.connect();
    console.log('✅ Kafka Producer connected');
  }

  async onModuleDestroy() {
    await this.producer.disconnect();
  }

  async publishEvent(eventType: string, data: any) {
    try {
      await this.producer.send({
        topic: 'procurement.events',
        messages: [
          {
            key: eventType,
            value: JSON.stringify({
              eventType,
              data,
              service: 'user-service',
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      });
      console.log(`📤 Event published: ${eventType}`);
    } catch (error) {
      console.error('Failed to publish event:', error);
    }
  }
}
