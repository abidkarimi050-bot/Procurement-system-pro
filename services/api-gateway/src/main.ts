import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS
  app.enableCors({
    origin: ['http://localhost:3100', 'http://localhost:5173', 'http://127.0.0.1:3100', 'http://127.0.0.1:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global prefix for all routes
  app.setGlobalPrefix('api/v1');

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`
  ┌─────────────────────────────────────────┐
  │  🚀 API Gateway is running!             │
  ├─────────────────────────────────────────┤
  │  Port: ${port}                              │
  │  URL: http://localhost:${port}              │
  │  Health: http://localhost:${port}/api/v1/health │
  └─────────────────────────────────────────┘
  `);
}

bootstrap();
