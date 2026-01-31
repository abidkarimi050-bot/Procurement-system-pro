import { Controller, Get, Post, Put, Body, Param, Query, HttpException, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';

@Injectable()
@Controller('departments')
export class DepartmentController {
  private readonly userServiceUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.userServiceUrl = this.configService.get<string>('USER_SERVICE_URL') || 'http://user-service:3002';
  }

  @Post()
  async create(@Body() createDepartmentDto: any) {
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.userServiceUrl}/api/v1/departments`, createDepartmentDto)
      );
      return response.data;
    } catch (error) {
      throw new HttpException(error.response?.data || 'User service error', error.response?.status || 500);
    }
  }

  @Get()
  async findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    try {
      const params = new URLSearchParams();
      if (page) params.append('page', page.toString());
      if (limit) params.append('limit', limit.toString());

      const response = await firstValueFrom(
        this.httpService.get(`${this.userServiceUrl}/api/v1/departments?${params.toString()}`)
      );
      return response.data;
    } catch (error) {
      throw new HttpException(error.response?.data || 'User service error', error.response?.status || 500);
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.userServiceUrl}/api/v1/departments/${id}`)
      );
      return response.data;
    } catch (error) {
      throw new HttpException(error.response?.data || 'User service error', error.response?.status || 500);
    }
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateDepartmentDto: any) {
    try {
      const response = await firstValueFrom(
        this.httpService.put(`${this.userServiceUrl}/api/v1/departments/${id}`, updateDepartmentDto)
      );
      return response.data;
    } catch (error) {
      throw new HttpException(error.response?.data || 'User service error', error.response?.status || 500);
    }
  }
}
