import { database } from '@/config/database'
import { createLogger } from '@/utils/logger'

const logger = createLogger('DatabasePoolService')

export interface PoolMetrics {
  timestamp: Date
  readyState: number
  host?: string
  port?: number
  name?: string
  poolSize: number
  maxPoolSize: number
  minPoolSize: number
  maxIdleTimeMS: number
  serverSelectionTimeoutMS: number
  socketTimeoutMS: number
  waitQueueTimeoutMS: number
  retryWrites: boolean
  retryReads: boolean
  readPreference: string
  connectionUtilization: number // percentage of pool being used
}

export interface PoolHealthStatus {
  status: 'healthy' | 'warning' | 'critical' | 'unknown'
  metrics: PoolMetrics
  issues: string[]
  recommendations: string[]
}

class DatabasePoolService {
  private metricsHistory: PoolMetrics[] = []
  private maxHistorySize = 100 // Keep last 100 metrics entries
  private monitoringInterval: NodeJS.Timeout | null = null

  /**
   * Start monitoring the database connection pool
   */
  public startMonitoring(intervalMs: number = 30000): void {
    if (this.monitoringInterval) {
      logger.warn('Database pool monitoring is already running')
      return
    }

    logger.info(`Starting database pool monitoring with ${intervalMs}ms interval`)
    
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics()
    }, intervalMs)

    // Collect initial metrics
    this.collectMetrics()
  }

  /**
   * Stop monitoring the database connection pool
   */
  public stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
      this.monitoringInterval = null
      logger.info('Database pool monitoring stopped')
    }
  }

  /**
   * Collect current pool metrics
   */
  public collectMetrics(): PoolMetrics {
    const stats = database.getConnectionPoolStats()
    const metrics: PoolMetrics = {
      timestamp: new Date(),
      readyState: stats.readyState,
      host: stats.host,
      port: stats.port,
      name: stats.name,
      poolSize: stats.poolSize,
      maxPoolSize: stats.maxPoolSize,
      minPoolSize: stats.minPoolSize,
      maxIdleTimeMS: stats.maxIdleTimeMS,
      serverSelectionTimeoutMS: stats.serverSelectionTimeoutMS,
      socketTimeoutMS: stats.socketTimeoutMS,
      waitQueueTimeoutMS: stats.waitQueueTimeoutMS,
      retryWrites: stats.retryWrites,
      retryReads: stats.retryReads,
      readPreference: stats.readPreference,
      connectionUtilization: this.calculateConnectionUtilization(stats.poolSize, stats.maxPoolSize)
    }

    // Add to history
    this.metricsHistory.push(metrics)
    if (this.metricsHistory.length > this.maxHistorySize) {
      this.metricsHistory.shift()
    }

    logger.debug('Database pool metrics collected', {
      poolSize: metrics.poolSize,
      maxPoolSize: metrics.maxPoolSize,
      utilization: `${metrics.connectionUtilization}%`
    })

    return metrics
  }

  /**
   * Get current pool metrics
   */
  public getCurrentMetrics(): PoolMetrics | null {
    if (this.metricsHistory.length === 0) {
      return this.collectMetrics()
    }
    return this.metricsHistory[this.metricsHistory.length - 1]
  }

  /**
   * Get metrics history
   */
  public getMetricsHistory(limit?: number): PoolMetrics[] {
    if (limit) {
      return this.metricsHistory.slice(-limit)
    }
    return [...this.metricsHistory]
  }

  /**
   * Get pool health status with recommendations
   */
  public getPoolHealthStatus(): PoolHealthStatus {
    const metrics = this.getCurrentMetrics()
    
    if (!metrics) {
      return {
        status: 'unknown',
        metrics: {} as PoolMetrics,
        issues: ['Unable to collect pool metrics'],
        recommendations: ['Check database connection']
      }
    }

    const issues: string[] = []
    const recommendations: string[] = []

    // Check connection state
    if (metrics.readyState !== 1) {
      issues.push('Database is not connected')
      recommendations.push('Check database connection and configuration')
    }

    // Check connection utilization
    if (metrics.connectionUtilization > 90) {
      issues.push(`High connection utilization: ${metrics.connectionUtilization}%`)
      recommendations.push('Consider increasing maxPoolSize')
    } else if (metrics.connectionUtilization > 75) {
      issues.push(`Elevated connection utilization: ${metrics.connectionUtilization}%`)
      recommendations.push('Monitor closely, consider increasing maxPoolSize if trend continues')
    }

    // Check pool size configuration
    if (metrics.maxPoolSize < 10) {
      issues.push(`Low maxPoolSize: ${metrics.maxPoolSize}`)
      recommendations.push('Consider increasing maxPoolSize for better concurrency')
    }

    // Check timeout configurations
    if (metrics.serverSelectionTimeoutMS < 5000) {
      issues.push(`Low server selection timeout: ${metrics.serverSelectionTimeoutMS}ms`)
      recommendations.push('Consider increasing serverSelectionTimeoutMS for better reliability')
    }

    // Check idle time configuration
    if (metrics.maxIdleTimeMS < 10000) {
      issues.push(`Low max idle time: ${metrics.maxIdleTimeMS}ms`)
      recommendations.push('Consider increasing maxIdleTimeMS to reduce connection churn')
    }

    // Determine overall status
    let status: 'healthy' | 'warning' | 'critical' | 'unknown' = 'healthy'
    
    if (metrics.readyState !== 1) {
      status = 'critical'
    } else if (issues.length > 0) {
      status = issues.some(issue => issue.includes('critical') || metrics.connectionUtilization > 90) ? 'critical' : 'warning'
    }

    return {
      status,
      metrics,
      issues,
      recommendations
    }
  }

  /**
   * Get performance recommendations based on metrics history
   */
  public getPerformanceRecommendations(): string[] {
    const recommendations: string[] = []
    const history = this.getMetricsHistory(20) // Last 20 data points

    if (history.length < 5) {
      recommendations.push('Collect more metrics data for better recommendations')
      return recommendations
    }

    // Analyze connection utilization trends
    const avgUtilization = history.reduce((sum, m) => sum + m.connectionUtilization, 0) / history.length
    const maxUtilization = Math.max(...history.map(m => m.connectionUtilization))

    if (avgUtilization > 80) {
      recommendations.push(`Average utilization is high (${avgUtilization.toFixed(1)}%). Consider increasing maxPoolSize.`)
    }

    if (maxUtilization > 95) {
      recommendations.push(`Peak utilization reached ${maxUtilization}%. Increase maxPoolSize to handle load spikes.`)
    }

    // Check for connection churn
    const utilizationVariance = this.calculateVariance(history.map(m => m.connectionUtilization))
    if (utilizationVariance > 400) { // High variance indicates churn
      recommendations.push('High connection utilization variance detected. Consider adjusting minPoolSize or maxIdleTimeMS.')
    }

    // Check timeout configurations
    const latestMetrics = history[history.length - 1]
    if (latestMetrics.serverSelectionTimeoutMS > 10000) {
      recommendations.push('High server selection timeout may indicate network issues. Check network connectivity.')
    }

    return recommendations
  }

  /**
   * Calculate connection utilization percentage
   */
  private calculateConnectionUtilization(currentSize: number, maxSize: number): number {
    if (maxSize === 0) return 0
    return Math.round((currentSize / maxSize) * 100)
  }

  /**
   * Calculate variance of an array of numbers
   */
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2))
    return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length
  }

  /**
   * Reset metrics history
   */
  public resetMetrics(): void {
    this.metricsHistory = []
    logger.info('Database pool metrics history reset')
  }

  /**
   * Get monitoring status
   */
  public getMonitoringStatus(): { isMonitoring: boolean; intervalMs?: number } {
    return {
      isMonitoring: this.monitoringInterval !== null,
      intervalMs: this.monitoringInterval ? 30000 : undefined // Default interval
    }
  }
}

// Export singleton instance
export const databasePoolService = new DatabasePoolService()
export default databasePoolService
