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
      console.log('🌐 [API] Запрос GET /merchgroups');
      const response = await this.apiClient.get<MerchGroupsResponse>('/merchgroups');
      console.log('✅ [API] Ответ GET /merchgroups:', JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error('❌ [API] Ошибка GET /merchgroups:', error);
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
      console.log('🌐 [API] Запрос GET /shelves/summary');
      const response = await this.apiClient.get<ShelfSummaryResponse>('/shelves/summary');
      console.log('✅ [API] Ответ GET /shelves/summary:', JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error('❌ [API] Ошибка GET /shelves/summary:', error);
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
      console.log(`🌐 [API] Запрос GET /shelves/merchgroup/${groupId}/voids/tasks`);
      const response = await this.apiClient.get<ShelvesVoidsResponse>(
        `/shelves/merchgroup/${groupId}/voids/tasks`
      );
      console.log(`✅ [API] Ответ GET /shelves/merchgroup/${groupId}/voids/tasks:`, JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error(`❌ [API] Ошибка GET /shelves/merchgroup/${groupId}/voids/tasks:`, error);
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
      console.log('🌐 [API] Запрос POST /tasks/action:', JSON.stringify(taskAction, null, 2));
      const response = await this.apiClient.post<TaskActionResponse>(
        '/tasks/action',
        taskAction
      );
      console.log('✅ [API] Ответ POST /tasks/action:', JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error('❌ [API] Ошибка POST /tasks/action:', error);
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
      console.log('🌐 [API] Запрос GET /prices/summary');
      const response = await this.apiClient.get<PriceSummaryResponse>('/prices/summary');
      console.log('✅ [API] Ответ GET /prices/summary:', JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error('❌ [API] Ошибка GET /prices/summary:', error);
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
      console.log(`🌐 [API] Запрос GET /prices/errortype/${errorType}/tasks`);
      const response = await this.apiClient.get<PriceErrorsResponse>(
        `/prices/errortype/${errorType}/tasks`
      );
      console.log(`✅ [API] Ответ GET /prices/errortype/${errorType}/tasks:`, JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error(`❌ [API] Ошибка GET /prices/errortype/${errorType}/tasks:`, error);
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
      console.log(`🌐 [API] Запрос GET /prices/merchgroup/${merchGroupId}/tasks`);
      const response = await this.apiClient.get<PriceErrorsResponse>(
        `/prices/merchgroup/${merchGroupId}/tasks`
      );
      console.log(`✅ [API] Ответ GET /prices/merchgroup/${merchGroupId}/tasks:`, JSON.stringify(response.data, null, 2));
      return response.data;
      } catch (error) {
      console.error(`❌ [API] Ошибка GET /prices/merchgroup/${merchGroupId}/tasks:`, error);
      throw new HttpException(
        'Ошибка при получении списка ошибок по ценникам в группе',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Сгенерировать PDF с ценниками для печати
   */
  async generateLabelsPdf(): Promise<{ file_url: string; filename: string }> {
    try {
      console.log('🌐 [API] Запрос GET /price_tags/pdf');
      const response = await this.apiClient.get('/price_tags/pdf');
      console.log('✅ [API] Ответ GET /price_tags/pdf:', JSON.stringify(response.data, null, 2));
      
      // Проверяем структуру ответа
      if (response.data && typeof response.data === 'object') {
        // Если API возвращает файл напрямую
        if (response.data.file_url && response.data.filename) {
          return {
            file_url: response.data.file_url,
            filename: response.data.filename
          };
        }
        
        // Если API возвращает только ссылку
        if (response.data.file_url) {
          return {
            file_url: response.data.file_url,
            filename: 'Ценники для печати.pdf'
          };
        }
        
        // Если API возвращает только название файла
        if (response.data.filename) {
          return {
            file_url: 'Файл готов к скачиванию',
            filename: response.data.filename
          };
        }
        
        // Если API возвращает что-то другое
        console.log('⚠️ Неожиданная структура ответа API');
        if (response.data.pdf_url) {
          // Если API возвращает pdf_url
          return {
            file_url: response.data.pdf_url,
            filename: 'Ценники для печати.pdf'
          };
        }
        return {
          file_url: 'Данные о файле недоступны',
          filename: 'Ценники для печати.pdf'
        };
      }
      
      // Если ответ пустой или не объект
      console.log('⚠️ Пустой или неожиданный ответ API');
      return {
        file_url: 'Файл сгенерирован, но ссылка недоступна',
        filename: 'Ценники для печати.pdf'
      };
      
    } catch (error) {
      console.error('❌ Ошибка при генерации PDF:', error);
      throw new HttpException(
        'Ошибка при генерации PDF с ценниками',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
