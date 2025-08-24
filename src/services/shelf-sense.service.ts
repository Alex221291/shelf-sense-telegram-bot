import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  MerchGroupsResponse,
  ShelfSummaryResponse,
  PriceSummaryResponse,
  ShelvesVoidsResponse,
  PriceErrorsResponse,
  TaskActionResponse,
  GenerateLabelsPdfResponse,
  TaskAction,
} from '../types/shelf-sense.types';

@Injectable()
export class ShelfSenseService {
  private readonly apiClient: AxiosInstance;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('SHELF_SENSE_API_URL') || 'http://localhost:8000';
    
    this.apiClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Добавляем перехватчик для обработки ошибок
    this.apiClient.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          throw new HttpException(
            error.response.data || 'API Error',
            error.response.status
          );
        }
        throw new HttpException('Network Error', HttpStatus.INTERNAL_SERVER_ERROR);
      }
    );
  }

  /**
   * Получить список мерч-групп
   */
  async getMerchGroups(): Promise<MerchGroupsResponse> {
    try {
      const response = await this.apiClient.get<MerchGroupsResponse>('/merchgroups');
      return response.data;
    } catch (error) {
      throw new HttpException(
        'Ошибка при получении мерч-групп',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Получить сводку по выкладке товара
   */
  async getShelfSummary(): Promise<ShelfSummaryResponse> {
    try {
      const response = await this.apiClient.get<ShelfSummaryResponse>('/shelves/summary');
      return response.data;
    } catch (error) {
      throw new HttpException(
        'Ошибка при получении сводки по выкладке',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Получить список пустот в выбранной мерч-группе
   */
  async getShelvesVoids(groupId: string): Promise<ShelvesVoidsResponse> {
    try {
      const response = await this.apiClient.get<ShelvesVoidsResponse>(
        `/shelves/merchgroup/${groupId}/voids/tasks`
      );
      return response.data;
    } catch (error) {
      throw new HttpException(
        'Ошибка при получении списка пустот',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Отметить выполнение или отмену задания
   */
  async markTaskAction(taskAction: TaskAction): Promise<TaskActionResponse> {
    try {
      const response = await this.apiClient.post<TaskActionResponse>(
        '/tasks/action',
        taskAction
      );
      return response.data;
    } catch (error) {
      throw new HttpException(
        'Ошибка при отметке выполнения задания',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Получить сводку по ценникам
   */
  async getPriceSummary(): Promise<PriceSummaryResponse> {
    try {
      const response = await this.apiClient.get<PriceSummaryResponse>('/prices/summary');
      return response.data;
    } catch (error) {
      throw new HttpException(
        'Ошибка при получении сводки по ценникам',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Получить список ошибок по ценникам по типу ошибки
   */
  async getPriceErrorsByType(errorType: string): Promise<PriceErrorsResponse> {
    try {
      const response = await this.apiClient.get<PriceErrorsResponse>(
        `/prices/errortype/${errorType}/tasks`
      );
      return response.data;
    } catch (error) {
      throw new HttpException(
        'Ошибка при получении списка ошибок по ценникам',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Получить список ошибок по ценникам в выбранной группе
   */
  async getPriceErrorsByGroup(merchGroupId: string): Promise<PriceErrorsResponse> {
    try {
      const response = await this.apiClient.get<PriceErrorsResponse>(
        `/prices/merchgroup/${merchGroupId}/tasks`
      );
      return response.data;
    } catch (error) {
      throw new HttpException(
        'Ошибка при получении списка ошибок по ценникам в группе',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Сгенерировать PDF с ценниками для печати
   */
  async generateLabelsPdf(): Promise<GenerateLabelsPdfResponse> {
    try {
      const response = await this.apiClient.get<GenerateLabelsPdfResponse>('/price_tags/pdf');
      return response.data;
    } catch (error) {
      throw new HttpException(
        'Ошибка при генерации PDF с ценниками',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
