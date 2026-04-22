import { DatabaseConnection } from '@/config/database'
import { databasePoolService } from '@/services/databasePoolService'

// Mock logger to avoid test output
jest.mock('@/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}))

// Mock mongoose
jest.mock('mongoose', () => ({
  connect: jest.fn(),
  disconnect: jest.fn(),
  connection: {
    readyState: 1,
    host: 'localhost',
    port: 27017,
    name: 'test',
    db: {
      admin: () => ({
        ping: jest.fn().mockResolvedValue(true),
        serverStatus: jest.fn().mockResolvedValue({
          connections: {
            current: 5
          }
        })
      })
    },
    on: jest.fn()
  }
}))

describe('DatabaseConnection', () => {
  let database: DatabaseConnection

  beforeEach(() => {
    database = DatabaseConnection.getInstance()
    jest.clearAllMocks()
  })

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = DatabaseConnection.getInstance()
      const instance2 = DatabaseConnection.getInstance()
      expect(instance1).toBe(instance2)
    })
  })

  describe('Connection Management', () => {
    it('should connect successfully', async () => {
      const mongoose = require('mongoose')
      mongoose.connect.mockResolvedValue(undefined)

      await database.connect()

      expect(mongoose.connect).toHaveBeenCalledWith(
        'mongodb://localhost:27017/muse',
        expect.objectContaining({
          maxPoolSize: 50,
          minPoolSize: 5,
          maxIdleTimeMS: 30000,
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 45000,
          bufferCommands: false,
          bufferMaxEntries: 0,
          waitQueueTimeoutMS: 10000,
          retryWrites: true,
          retryReads: true,
          readPreference: 'primary',
          writeConcern: {
            w: 'majority',
            j: true
          }
        })
      )
    })

    it('should use environment variables for configuration', async () => {
      process.env.DB_MAX_POOL_SIZE = '100'
      process.env.DB_MIN_POOL_SIZE = '10'
      process.env.DB_MAX_IDLE_TIME_MS = '60000'

      const mongoose = require('mongoose')
      mongoose.connect.mockResolvedValue(undefined)

      await database.connect()

      expect(mongoose.connect).toHaveBeenCalledWith(
        'mongodb://localhost:27017/muse',
        expect.objectContaining({
          maxPoolSize: 100,
          minPoolSize: 10,
          maxIdleTimeMS: 60000
        })
      )

      // Clean up
      delete process.env.DB_MAX_POOL_SIZE
      delete process.env.DB_MIN_POOL_SIZE
      delete process.env.DB_MAX_IDLE_TIME_MS
    })

    it('should not connect if already connected', async () => {
      const mongoose = require('mongoose')
      mongoose.connect.mockResolvedValue(undefined)

      // First connection
      await database.connect()
      const firstCallCount = mongoose.connect.mock.calls.length

      // Second connection should not call mongoose.connect again
      await database.connect()
      const secondCallCount = mongoose.connect.mock.calls.length

      expect(firstCallCount).toBe(1)
      expect(secondCallCount).toBe(1)
    })

    it('should handle connection errors', async () => {
      const mongoose = require('mongoose')
      const error = new Error('Connection failed')
      mongoose.connect.mockRejectedValue(error)

      await expect(database.connect()).rejects.toThrow('Connection failed')
    })
  })

  describe('Pool Statistics', () => {
    it('should return pool statistics', () => {
      const stats = database.getConnectionPoolStats()

      expect(stats).toEqual({
        readyState: 1,
        host: 'localhost',
        port: 27017,
        name: 'test',
        poolSize: 5,
        maxPoolSize: 50,
        minPoolSize: 5,
        maxIdleTimeMS: 30000,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        waitQueueTimeoutMS: 10000,
        retryWrites: true,
        retryReads: true,
        readPreference: 'primary'
      })
    })
  })

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const health = await database.healthCheck()

      expect(health).toEqual({
        status: 'healthy',
        responseTime: expect.any(Number)
      })
    })

    it('should handle health check errors', async () => {
      const mongoose = require('mongoose')
      mongoose.connection.db.admin().ping.mockRejectedValue(new Error('Ping failed'))

      const health = await database.healthCheck()

      expect(health).toEqual({
        status: 'unhealthy'
      })
    })
  })
})

describe('DatabasePoolService', () => {
  beforeEach(() => {
    databasePoolService.resetMetrics()
    jest.clearAllMocks()
  })

  describe('Metrics Collection', () => {
    it('should collect current metrics', () => {
      const metrics = databasePoolService.collectMetrics()

      expect(metrics).toEqual({
        timestamp: expect.any(Date),
        readyState: 1,
        host: 'localhost',
        port: 27017,
        name: 'test',
        poolSize: 5,
        maxPoolSize: 50,
        minPoolSize: 5,
        maxIdleTimeMS: 30000,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        waitQueueTimeoutMS: 10000,
        retryWrites: true,
        retryReads: true,
        readPreference: 'primary',
        connectionUtilization: 10 // 5/50 * 100
      })
    })

    it('should maintain metrics history', () => {
      const metrics1 = databasePoolService.collectMetrics()
      const metrics2 = databasePoolService.collectMetrics()

      const history = databasePoolService.getMetricsHistory()

      expect(history).toHaveLength(2)
      expect(history[0]).toEqual(metrics1)
      expect(history[1]).toEqual(metrics2)
    })

    it('should limit history size', () => {
      // Add more metrics than the max history size
      for (let i = 0; i < 105; i++) {
        databasePoolService.collectMetrics()
      }

      const history = databasePoolService.getMetricsHistory()
      expect(history).toHaveLength(100) // Max history size
    })
  })

  describe('Health Status', () => {
    it('should return healthy status for good metrics', () => {
      databasePoolService.collectMetrics()

      const health = databasePoolService.getPoolHealthStatus()

      expect(health.status).toBe('healthy')
      expect(health.issues).toHaveLength(0)
      expect(health.recommendations).toHaveLength(0)
    })

    it('should return warning status for high utilization', () => {
      // Mock high utilization by modifying the stats
      jest.doMock('@/config/database', () => ({
        database: {
          getConnectionPoolStats: () => ({
            readyState: 1,
            host: 'localhost',
            port: 27017,
            name: 'test',
            poolSize: 45, // 90% utilization
            maxPoolSize: 50,
            minPoolSize: 5,
            maxIdleTimeMS: 30000,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            waitQueueTimeoutMS: 10000,
            retryWrites: true,
            retryReads: true,
            readPreference: 'primary'
          })
        }
      }))

      databasePoolService.collectMetrics()
      const health = databasePoolService.getPoolHealthStatus()

      expect(health.status).toBe('warning')
      expect(health.issues).toContain('High connection utilization: 90%')
      expect(health.recommendations).toContain('Consider increasing maxPoolSize')
    })

    it('should return critical status for disconnected database', () => {
      // Mock disconnected state
      jest.doMock('@/config/database', () => ({
        database: {
          getConnectionPoolStats: () => ({
            readyState: 0, // Disconnected
            host: 'localhost',
            port: 27017,
            name: 'test',
            poolSize: 0,
            maxPoolSize: 50,
            minPoolSize: 5,
            maxIdleTimeMS: 30000,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            waitQueueTimeoutMS: 10000,
            retryWrites: true,
            retryReads: true,
            readPreference: 'primary'
          })
        }
      }))

      databasePoolService.collectMetrics()
      const health = databasePoolService.getPoolHealthStatus()

      expect(health.status).toBe('critical')
      expect(health.issues).toContain('Database is not connected')
    })
  })

  describe('Performance Recommendations', () => {
    it('should provide recommendations for high utilization', () => {
      // Simulate high utilization history
      for (let i = 0; i < 10; i++) {
        jest.doMock('@/config/database', () => ({
          database: {
            getConnectionPoolStats: () => ({
              readyState: 1,
              host: 'localhost',
              port: 27017,
              name: 'test',
              poolSize: 45, // 90% utilization
              maxPoolSize: 50,
              minPoolSize: 5,
              maxIdleTimeMS: 30000,
              serverSelectionTimeoutMS: 5000,
              socketTimeoutMS: 45000,
              waitQueueTimeoutMS: 10000,
              retryWrites: true,
              retryReads: true,
              readPreference: 'primary'
            })
          }
        }))
        databasePoolService.collectMetrics()
      }

      const recommendations = databasePoolService.getPerformanceRecommendations()

      expect(recommendations).toContain(
        expect.stringContaining('Average utilization is high')
      )
    })

    it('should return early if insufficient data', () => {
      // Only add 2 data points
      databasePoolService.collectMetrics()
      databasePoolService.collectMetrics()

      const recommendations = databasePoolService.getPerformanceRecommendations()

      expect(recommendations).toContain(
        'Collect more metrics data for better recommendations'
      )
    })
  })

  describe('Monitoring Control', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
      databasePoolService.stopMonitoring()
    })

    it('should start monitoring', () => {
      const collectMetricsSpy = jest.spyOn(databasePoolService, 'collectMetrics')

      databasePoolService.startMonitoring(1000)

      expect(collectMetricsSpy).toHaveBeenCalledTimes(1) // Initial collection

      // Fast-forward time
      jest.advanceTimersByTime(1000)

      expect(collectMetricsSpy).toHaveBeenCalledTimes(2) // After interval
    })

    it('should stop monitoring', () => {
      const collectMetricsSpy = jest.spyOn(databasePoolService, 'collectMetrics')

      databasePoolService.startMonitoring(1000)
      databasePoolService.stopMonitoring()

      // Fast-forward time
      jest.advanceTimersByTime(2000)

      expect(collectMetricsSpy).toHaveBeenCalledTimes(1) // Only initial collection
    })

    it('should not start monitoring if already running', () => {
      const logger = require('@/utils/logger').createLogger()
      
      databasePoolService.startMonitoring(1000)
      databasePoolService.startMonitoring(1000)

      expect(logger.warn).toHaveBeenCalledWith('Database pool monitoring is already running')
    })
  })

  describe('Monitoring Status', () => {
    it('should return monitoring status when not monitoring', () => {
      const status = databasePoolService.getMonitoringStatus()

      expect(status).toEqual({
        isMonitoring: false
      })
    })

    it('should return monitoring status when monitoring', () => {
      jest.useFakeTimers()
      databasePoolService.startMonitoring(1000)

      const status = databasePoolService.getMonitoringStatus()

      expect(status).toEqual({
        isMonitoring: true,
        intervalMs: 30000
      })

      jest.useRealTimers()
      databasePoolService.stopMonitoring()
    })
  })

  describe('Metrics Reset', () => {
    it('should reset metrics history', () => {
      databasePoolService.collectMetrics()
      databasePoolService.collectMetrics()

      expect(databasePoolService.getMetricsHistory()).toHaveLength(2)

      databasePoolService.resetMetrics()

      expect(databasePoolService.getMetricsHistory()).toHaveLength(0)
    })
  })
})
