import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpException, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';

@Injectable()
@Controller('users')
export class UserController {
  private readonly userServiceUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.userServiceUrl = this.configService.get<string>('USER_SERVICE_URL') || 'http://user-service:3002';
  }

  @Post()
  async create(@Body() createUserDto: any) {
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.userServiceUrl}/api/v1/users`, createUserDto)
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
    @Query('search') search?: string,
  ) {
    try {
      const params = new URLSearchParams();
      if (page) params.append('page', page.toString());
      if (limit) params.append('limit', limit.toString());
      if (search) params.append('search', search);

      const response = await firstValueFrom(
        this.httpService.get(`${this.userServiceUrl}/api/v1/users?${params.toString()}`)
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
        this.httpService.get(`${this.userServiceUrl}/api/v1/users/${id}`)
      );
      return response.data;
    } catch (error) {
      throw new HttpException(error.response?.data || 'User service error', error.response?.status || 500);
    }
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateUserDto: any) {
    try {
      const response = await firstValueFrom(
        this.httpService.put(`${this.userServiceUrl}/api/v1/users/${id}`, updateUserDto)
      );
      return response.data;
    } catch (error) {
      throw new HttpException(error.response?.data || 'User service error', error.response?.status || 500);
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.delete(`${this.userServiceUrl}/api/v1/users/${id}`)
      );
      return response.data;
    } catch (error) {
      throw new HttpException(error.response?.data || 'User service error', error.response?.status || 500);
    }
  }
}
