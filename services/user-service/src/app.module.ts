import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserController } from './controllers/user.controller';
import { DepartmentController } from './controllers/department.controller';
import { HealthController } from './controllers/health.controller';
import { UserService } from './services/user.service';
import { DepartmentService } from './services/department.service';
import { KafkaProducerService } from './kafka/kafka-producer.service';
import { User } from './entities/user.entity';
import { Department } from './entities/department.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DATABASE_HOST || 'postgres',
      port: parseInt(process.env.DATABASE_PORT) || 5432,
      username: process.env.DATABASE_USER || 'procurement',
      password: process.env.DATABASE_PASSWORD || 'secure_password_123',
      database: process.env.DATABASE_NAME || 'user_service',
      entities: [User, Department],
      synchronize: true, // Set to false in production
      logging: process.env.NODE_ENV === 'development',
    }),
    TypeOrmModule.forFeature([User, Department]),
  ],
  controllers: [UserController, DepartmentController, HealthController],
  providers: [UserService, DepartmentService, KafkaProducerService],
})
export class AppModule {}
