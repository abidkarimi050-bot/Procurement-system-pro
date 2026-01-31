import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { User } from '../entities/user.entity';
import { CreateUserDto, UpdateUserDto } from '../dto/user.dto';
import { KafkaProducerService } from '../kafka/kafka-producer.service';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private kafkaProducer: KafkaProducerService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    const user = this.userRepository.create(createUserDto);
    const savedUser = await this.userRepository.save(user);

    // Publish event to Kafka
    await this.kafkaProducer.publishEvent('user.created', {
      user_id: savedUser.id,
      email: savedUser.email,
      timestamp: new Date().toISOString(),
    });

    return savedUser;
  }

  async findAll(page: number = 1, limit: number = 20, search?: string) {
    const skip = (page - 1) * limit;
    
    const whereCondition = search
      ? [
          { first_name: Like(`%${search}%`) },
          { last_name: Like(`%${search}%`) },
          { email: Like(`%${search}%`) },
        ]
      : {};

    const [data, total] = await this.userRepository.findAndCount({
      where: whereCondition,
      relations: ['department'],
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
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['department'],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.findOne(id);
    Object.assign(user, updateUserDto);
    const updatedUser = await this.userRepository.save(user);

    // Publish event to Kafka
    await this.kafkaProducer.publishEvent('user.updated', {
      user_id: updatedUser.id,
      timestamp: new Date().toISOString(),
    });

    return updatedUser;
  }

  async remove(id: string) {
    const user = await this.findOne(id);
    user.is_active = false;
    await this.userRepository.save(user);

    // Publish event to Kafka
    await this.kafkaProducer.publishEvent('user.deleted', {
      user_id: id,
      timestamp: new Date().toISOString(),
    });

    return { message: 'User deactivated successfully' };
  }
}
