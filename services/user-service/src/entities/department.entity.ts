import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany } from 'typeorm';
import { User } from './user.entity';

@Entity('departments')
export class Department {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 20, unique: true })
  code: string;

  @Column({ type: 'uuid', nullable: true })
  parent_id: string;

  @ManyToOne(() => Department, { nullable: true })
  parent: Department;

  @Column({ type: 'uuid', nullable: true })
  manager_id: string;

  @ManyToOne(() => User, { nullable: true })
  manager: User;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ length: 50, nullable: true })
  cost_center: string;

  @Column({ default: true })
  is_active: boolean;

  @Column({ type: 'uuid' })
  created_by: string;

  @CreateDateColumn()
  created_at: Date;

  @Column({ type: 'uuid', nullable: true })
  updated_by: string;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => User, user => user.department)
  users: User[];
}
