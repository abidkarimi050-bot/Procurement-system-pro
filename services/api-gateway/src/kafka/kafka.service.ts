import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Kafka, Producer, Consumer } from 'kafkajs';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private kafka: Kafka;
  private producer: Producer;
  private consumer: Consumer;
  private isConnected = false;

  async onModuleInit() {
    try {
      // Initialize Kafka client
      this.kafka = new Kafka({
        clientId: process.env.KAFKA_CLIENT_ID || 'api-gateway',
        brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
        retry: {
          initialRetryTime: 300,
          retries: 10,
        },
      });

      // Create producer
      this.producer = this.kafka.producer();
      await this.producer.connect();
      this.isConnected = true;

      this.logger.log('✅ Kafka producer connected successfully');

      // Create consumer (for future use)
      this.consumer = this.kafka.consumer({
        groupId: process.env.KAFKA_GROUP_ID || 'api-gateway-group',
      });
      await this.consumer.connect();

      this.logger.log('✅ Kafka consumer connected successfully');
    } catch (error) {
      this.logger.error('❌ Failed to connect to Kafka', error.message);
      this.isConnected = false;
      // Don't crash the app, just log the error
    }
  }

  async onModuleDestroy() {
    try {
      if (this.producer) {
        await this.producer.disconnect();
      }
      if (this.consumer) {
        await this.consumer.disconnect();
      }
      this.logger.log('Kafka connections closed');
    } catch (error) {
      this.logger.error('Error closing Kafka connections', error);
    }
  }

  /**
   * Publish an event to Kafka
   */
  async publishEvent(topic: string, event: any): Promise<void> {
    try {
      if (!this.isConnected) {
        this.logger.warn(`Kafka not connected. Skipping event: ${topic}`);
        return;
      }

      await this.producer.send({
        topic,
        messages: [
          {
            key: event.id || Date.now().toString(),
            value: JSON.stringify(event),
            timestamp: Date.now().toString(),
          },
        ],
      });

      this.logger.log(`📤 Event published to topic: ${topic}`);
    } catch (error) {
      this.logger.error(`Failed to publish event to ${topic}`, error);
      throw error;
    }
  }

  /**
   * Check if Kafka is connected
   */
  async checkConnection(): Promise<boolean> {
    return this.isConnected;
  }

  /**
   * Subscribe to topics (for future use)
   */
  async subscribe(topics: string[], callback: (message: any) => void): Promise<void> {
    try {
      await this.consumer.subscribe({ topics, fromBeginning: false });

      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          if (!message.value) {
            this.logger.warn(`Received empty message from topic: ${topic}`);
            return;
          }
          
          const event = JSON.parse(message.value.toString());
          this.logger.log(`📥 Received event from topic: ${topic}`);
          callback({ topic, partition, event });
        },
      });
    } catch (error) {
      this.logger.error('Failed to subscribe to topics', error);
      throw error;
    }
  }
}
