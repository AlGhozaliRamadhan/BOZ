import { log } from './logger.js';

/**
 * Executes a promise-returning function with exponential backoff retry.
 * 
 * @param fn The function to execute.
 * @param maxRetries Maximum number of retries (default: 3).
 * @param baseDelayMs Base delay in milliseconds (default: 1000).
 * @param shouldRetry Optional predicate to determine if an error should trigger a retry.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000,
  shouldRetry?: (error: any) => boolean
): Promise<T> {
  let attempt = 0;
  
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      
      const isRetryable = shouldRetry 
        ? shouldRetry(error) 
        : (
            // Default retry logic for standard HTTP/Network errors
            error?.status === 429 || 
            (error?.status >= 500 && error?.status < 600) ||
            error?.code === 'ECONNRESET' ||
            error?.code === 'ETIMEDOUT' ||
            error?.code === 'ENOTFOUND'
          );

      if (!isRetryable || attempt > maxRetries) {
        throw error;
      }
      
      const delay = baseDelayMs * Math.pow(2, attempt - 1); // Exponential backoff: 1s, 2s, 4s...
      log.warn('retry', `Operation failed, retrying (${attempt}/${maxRetries}) in ${delay}ms... [Error: ${error.message}]`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
