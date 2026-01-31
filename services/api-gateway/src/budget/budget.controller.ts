import { Controller, Get, Param, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller('budgets')
export class BudgetController {
  private readonly budgetServiceUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.budgetServiceUrl = this.configService.get<string>('BUDGET_SERVICE_URL') || 'http://budget-service:8080';
  }

  /**
   * Proxy to Budget Service - Get available budget
   * GET /api/v1/budgets/{departmentId}/available
   */
  @Get(':departmentId/available')
  async getAvailableBudget(@Param('departmentId') departmentId: string) {
    try {
      const response = await fetch(
        `${this.budgetServiceUrl}/api/v1/budgets/${departmentId}/available`
      );

      if (!response.ok) {
        throw new HttpException(
          `Budget service error: ${response.statusText}`,
          response.status
        );
      }

      const data = await response.json();
      return data;
    } catch (error: any) {
      console.error('Error calling Budget Service:', error.message);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        'Failed to fetch budget information',
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }
}
