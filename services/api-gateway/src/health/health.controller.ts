import { Controller, Get } from '@nestjs/common';
import { KafkaService } from '../kafka/kafka.service';

@Controller('health')
export class HealthController {
  constructor(private readonly kafkaService: KafkaService) {}

  @Get()
  async getHealth() {
    const kafkaStatus = await this.kafkaService.checkConnection();

    return {
      status: 'healthy',
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      dependencies: {
        kafka: kafkaStatus ? 'connected' : 'disconnected',
      },
      environment: process.env.NODE_ENV || 'development',
    };
  }

  @Get('ready')
  getReady() {
    return {
      ready: true,
      message: 'API Gateway is ready to accept requests',
    };
  }

  @Get('live')
  getLive() {
    return {
      alive: true,
      message: 'API Gateway is alive',
    };
  }
}
