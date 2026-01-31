import { Controller, Post, Body, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller('requests')
export class RequestController {
  private readonly logger = new Logger(RequestController.name);
  private readonly requestServiceUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.requestServiceUrl = this.configService.get<string>('REQUEST_SERVICE_URL') || 'http://request-service:3001';
  }

  /**
   * Proxy to Request Service - Create purchase request
   * POST /api/v1/requests
   */
  @Post()
  async createRequest(@Body() body: any) {
    try {
      this.logger.log('Proxying request creation to Request Service');
      
      const response = await fetch(
        `${this.requestServiceUrl}/api/v1/requests`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        throw new HttpException(
          error.message || 'Request service error',
          response.status
        );
      }

      const data = await response.json();
      return data;
    } catch (error: any) {
      this.logger.error('Error calling Request Service:', error.message);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        'Failed to create purchase request',
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }
}
