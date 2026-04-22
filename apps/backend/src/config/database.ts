import mongoose from 'mongoose'
import { createLogger } from '@/utils/logger'

const logger = createLogger('Database')

export class DatabaseConnection {
  private static instance: DatabaseConnection
  private isConnected: boolean = false

  private constructor() {}

  public static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection()
    }
    return DatabaseConnection.instance
  }

  public async connect(): Promise<void> {
    if (this.isConnected) {
      logger.info('Database already connected')
      return
    }

    try {
      const mongoUri = process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/muse'
      
      const poolConfig = {
        // Connection pooling configuration with environment-based defaults
        maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE || '50'), // Maximum number of sockets in the connection pool
        minPoolSize: parseInt(process.env.DB_MIN_POOL_SIZE || '5'),  // Minimum number of sockets in the connection pool
        maxIdleTimeMS: parseInt(process.env.DB_MAX_IDLE_TIME_MS || '30000'), // Close connections after 30 seconds of inactivity
        serverSelectionTimeoutMS: parseInt(process.env.DB_SERVER_SELECTION_TIMEOUT_MS || '5000'), // How long to try selecting a server before giving up
        socketTimeoutMS: parseInt(process.env.DB_SOCKET_TIMEOUT_MS || '45000'), // How long a send or receive on a socket can take before timing out
        bufferCommands: false, // Disable mongoose buffering
        bufferMaxEntries: 0, // Disable mongoose buffering
        waitQueueTimeoutMS: parseInt(process.env.DB_WAIT_QUEUE_TIMEOUT_MS || '10000'), // How long to wait for a connection before timing out
        retryWrites: process.env.DB_RETRY_WRITES !== 'false', // Retry write operations if they fail
        retryReads: process.env.DB_RETRY_READS !== 'false', // Retry read operations if they fail
        readPreference: process.env.DB_READ_PREFERENCE || 'primary', // Read from primary by default
        writeConcern: {
          w: process.env.DB_WRITE_CONCERN_W || 'majority', // Write to majority of replica set members
          j: process.env.DB_WRITE_CONCERN_J !== 'false' // Ensure writes are written to journal
        }
      }

      await mongoose.connect(mongoUri, poolConfig)

      this.isConnected = true
      logger.info('Connected to MongoDB successfully')

      // Set up connection event listeners
      mongoose.connection.on('error', (error) => {
        logger.error('MongoDB connection error:', error)
        this.isConnected = false
      })

      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected')
        this.isConnected = false
      })

      mongoose.connection.on('reconnected', () => {
        logger.info('MongoDB reconnected')
        this.isConnected = true
      })

    } catch (error) {
      logger.error('Failed to connect to MongoDB:', error)
      this.isConnected = false
      throw error
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return
    }

    try {
      await mongoose.disconnect()
      this.isConnected = false
      logger.info('Disconnected from MongoDB')
    } catch (error) {
      logger.error('Error disconnecting from MongoDB:', error)
      throw error
    }
  }

  public getConnectionStatus(): boolean {
    return this.isConnected && mongoose.connection.readyState === 1
  }

  public async healthCheck(): Promise<{ status: string; responseTime?: number }> {
    const startTime = Date.now()
    
    try {
      await mongoose.connection.db?.admin().ping()
      const responseTime = Date.now() - startTime
      
      return {
        status: 'healthy',
        responseTime
      }
    } catch (error) {
      logger.error('Database health check failed:', error)
      return {
        status: 'unhealthy'
      }
    }
  }

  public getConnectionPoolStats() {
    const poolStats = {
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      port: mongoose.connection.port,
      name: mongoose.connection.name,
      poolSize: 0,
      maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE || '50'),
      minPoolSize: parseInt(process.env.DB_MIN_POOL_SIZE || '5'),
      maxIdleTimeMS: parseInt(process.env.DB_MAX_IDLE_TIME_MS || '30000'),
      serverSelectionTimeoutMS: parseInt(process.env.DB_SERVER_SELECTION_TIMEOUT_MS || '5000'),
      socketTimeoutMS: parseInt(process.env.DB_SOCKET_TIMEOUT_MS || '45000'),
      waitQueueTimeoutMS: parseInt(process.env.DB_WAIT_QUEUE_TIMEOUT_MS || '10000'),
      retryWrites: process.env.DB_RETRY_WRITES !== 'false',
      retryReads: process.env.DB_RETRY_READS !== 'false',
      readPreference: process.env.DB_READ_PREFERENCE || 'primary'
    }

    // Get detailed pool statistics if available
    if (mongoose.connection.db) {
      const admin = mongoose.connection.db.admin()
      try {
        const serverStatus = admin.serverStatus()
        if (serverStatus && serverStatus.connections) {
          poolStats.poolSize = serverStatus.connections.current || 0
        }
      } catch (error) {
        logger.warn('Could not fetch pool statistics:', error)
      }
    }

    return poolStats
  }
}

// Export singleton instance
export const database = DatabaseConnection.getInstance()
