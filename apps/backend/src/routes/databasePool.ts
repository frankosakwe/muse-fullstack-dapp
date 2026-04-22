import express from 'express'
import { createLogger } from '@/utils/logger'
import { databasePoolService } from '@/services/databasePoolService'
import { database } from '@/config/database'

const logger = createLogger('DatabasePoolRoutes')
const router = express.Router()

/**
 * GET /api/database/pool/metrics
 * Get current database connection pool metrics
 */
router.get('/metrics', async (req, res, next) => {
  try {
    const metrics = databasePoolService.getCurrentMetrics()
    
    if (!metrics) {
      return res.status(503).json({
        error: 'Unable to collect pool metrics',
        timestamp: new Date().toISOString()
      })
    }

    res.json({
      metrics,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error getting pool metrics:', error)
    next(error)
  }
})

/**
 * GET /api/database/pool/health
 * Get database connection pool health status
 */
router.get('/health', async (req, res, next) => {
  try {
    const healthStatus = databasePoolService.getPoolHealthStatus()
    
    res.json({
      ...healthStatus,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error getting pool health status:', error)
    next(error)
  }
})

/**
 * GET /api/database/pool/history
 * Get database connection pool metrics history
 */
router.get('/history', async (req, res, next) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined
    const history = databasePoolService.getMetricsHistory(limit)
    
    res.json({
      history,
      count: history.length,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error getting pool metrics history:', error)
    next(error)
  }
})

/**
 * GET /api/database/pool/recommendations
 * Get performance recommendations based on pool metrics
 */
router.get('/recommendations', async (req, res, next) => {
  try {
    const recommendations = databasePoolService.getPerformanceRecommendations()
    const healthStatus = databasePoolService.getPoolHealthStatus()
    
    res.json({
      recommendations,
      healthStatus: healthStatus.status,
      issues: healthStatus.issues,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error getting pool recommendations:', error)
    next(error)
  }
})

/**
 * GET /api/database/pool/stats
 * Get detailed database connection pool statistics
 */
router.get('/stats', async (req, res, next) => {
  try {
    const poolStats = database.getConnectionPoolStats()
    const monitoringStatus = databasePoolService.getMonitoringStatus()
    
    res.json({
      pool: poolStats,
      monitoring: monitoringStatus,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error getting pool stats:', error)
    next(error)
  }
})

/**
 * POST /api/database/pool/monitoring/start
 * Start database pool monitoring
 */
router.post('/monitoring/start', async (req, res, next) => {
  try {
    const intervalMs = req.body.intervalMs ? parseInt(req.body.intervalMs) : 30000
    
    if (intervalMs < 5000) {
      return res.status(400).json({
        error: 'Interval must be at least 5000ms (5 seconds)',
        provided: intervalMs
      })
    }

    databasePoolService.startMonitoring(intervalMs)
    
    res.json({
      message: 'Database pool monitoring started',
      intervalMs,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error starting pool monitoring:', error)
    next(error)
  }
})

/**
 * POST /api/database/pool/monitoring/stop
 * Stop database pool monitoring
 */
router.post('/monitoring/stop', async (req, res, next) => {
  try {
    databasePoolService.stopMonitoring()
    
    res.json({
      message: 'Database pool monitoring stopped',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error stopping pool monitoring:', error)
    next(error)
  }
})

/**
 * POST /api/database/pool/reset
 * Reset pool metrics history
 */
router.post('/reset', async (req, res, next) => {
  try {
    databasePoolService.resetMetrics()
    
    res.json({
      message: 'Database pool metrics history reset',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error resetting pool metrics:', error)
    next(error)
  }
})

export default router
