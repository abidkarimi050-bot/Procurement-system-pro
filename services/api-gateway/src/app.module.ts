import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { AppController } from './app.controller';
import { HealthController } from './health/health.controller';
import { KafkaModule } from './kafka/kafka.module';
import { BudgetController } from './budget/budget.controller';
import { RequestController } from './request/request.controller';
import { UserController } from './user/user.controller';
import { DepartmentController } from './department/department.controller';

@Module({
  imports: [
    // Load environment variables
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // HTTP Client for service-to-service calls
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 5,
    }),
    // Kafka for event streaming
    KafkaModule,
  ],
  controllers: [
    AppController,
    HealthController,
    UserController,
    DepartmentController,
    BudgetController,
    RequestController,
  ],
  providers: [],
})
export class AppModule {}

