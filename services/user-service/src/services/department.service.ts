import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Department } from '../entities/department.entity';
import { CreateDepartmentDto, UpdateDepartmentDto } from '../dto/department.dto';
import { KafkaProducerService } from '../kafka/kafka-producer.service';

@Injectable()
export class DepartmentService {
  constructor(
    @InjectRepository(Department)
    private departmentRepository: Repository<Department>,
    private kafkaProducer: KafkaProducerService,
  ) {}

  async create(createDepartmentDto: CreateDepartmentDto) {
    const department = this.departmentRepository.create(createDepartmentDto);
    const savedDepartment = await this.departmentRepository.save(department);

    // Publish event to Kafka
    await this.kafkaProducer.publishEvent('department.created', {
      department_id: savedDepartment.id,
      name: savedDepartment.name,
      code: savedDepartment.code,
      timestamp: new Date().toISOString(),
    });

    return savedDepartment;
  }

  async findAll(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [data, total] = await this.departmentRepository.findAndCount({
      relations: ['parent', 'manager'],
      skip,
      take: limit,
      order: { created_at: 'DESC' },
    });

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }

  async findOne(id: string) {
    const department = await this.departmentRepository.findOne({
      where: { id },
      relations: ['parent', 'manager', 'users'],
    });

    if (!department) {
      throw new NotFoundException(`Department with ID ${id} not found`);
    }

    return department;
  }

  async update(id: string, updateDepartmentDto: UpdateDepartmentDto) {
    const department = await this.findOne(id);
    Object.assign(department, updateDepartmentDto);
    const updatedDepartment = await this.departmentRepository.save(department);

    // Publish event to Kafka
    await this.kafkaProducer.publishEvent('department.updated', {
      department_id: updatedDepartment.id,
      timestamp: new Date().toISOString(),
    });

    return updatedDepartment;
  }
}
