import { cacheRedis } from '../lib/cache';
import crypto from 'crypto';

export interface SecurityEvent {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  data: {
    ip?: string;
    userAgent?: string;
    userId?: string;
    fingerprint?: string;
    [key: string]: any;
  };
  resolved?: boolean;
}

export interface FailedLoginAttempt {
  ip: string;
  attempts: number;
  lastAttempt: Date;
  userAgent?: string;
  userId?: string;
}

const SECURITY_EVENTS_KEY = 'docuchat:security_events';
const FAILED_LOGIN_KEY_PREFIX = 'docuchat:failed_login:';
const SECURITY_ALERT_THRESHOLD = 5; // Alert after 5 failed attempts
const FAILED_LOGIN_WINDOW = 15 * 60; // 15 minutes in seconds

/**
 * Track failed login attempts per IP
 */
export async function trackFailedLoginAttempt(
  ip: string,
  userAgent?: string,
  userId?: string,
  email?: string
): Promise<{ blocked: boolean; attempts: number; nextResetTime?: Date }> {
  const key = `${FAILED_LOGIN_KEY_PREFIX}${ip}`;
  const now = new Date();
  
  try {
    // Get current attempt data
    const existing = await cacheRedis.get(key);
    let attemptData: FailedLoginAttempt;
    
    if (existing) {
      attemptData = JSON.parse(existing);
      
      // Reset if window has expired
      const timeDiff = (now.getTime() - new Date(attemptData.lastAttempt).getTime()) / 1000;
      if (timeDiff > FAILED_LOGIN_WINDOW) {
        attemptData = {
          ip,
          attempts: 1,
          lastAttempt: now,
          userAgent,
          userId,
        };
      } else {
        attemptData.attempts++;
        attemptData.lastAttempt = now;
        if (userAgent) attemptData.userAgent = userAgent;
        if (userId) attemptData.userId = userId;
      }
    } else {
      attemptData = {
        ip,
        attempts: 1,
        lastAttempt: now,
        userAgent,
        userId,
      };
    }
    
    // Store updated data with TTL
    await cacheRedis.setex(key, FAILED_LOGIN_WINDOW, JSON.stringify(attemptData));
    
    // Create security event
    const securityEvent: SecurityEvent = {
      id: crypto.randomUUID(),
      type: 'failed_login',
      severity: attemptData.attempts >= SECURITY_ALERT_THRESHOLD ? 'high' : 'medium',
      timestamp: now,
      data: {
        ip,
        userAgent,
        userId,
        email,
        attemptCount: attemptData.attempts,
        windowMinutes: FAILED_LOGIN_WINDOW / 60,
      },
    };
    
    await logSecurityEvent(securityEvent);
    
    // Check if we should alert
    const blocked = attemptData.attempts >= SECURITY_ALERT_THRESHOLD;
    if (blocked) {
      await handleSecurityAlert(securityEvent);
    }
    
    const nextResetTime = new Date(attemptData.lastAttempt.getTime() + FAILED_LOGIN_WINDOW * 1000);
    
    return {
      blocked,
      attempts: attemptData.attempts,
      nextResetTime,
    };
    
  } catch (error) {
    console.error('Failed to track login attempt:', error);
    return { blocked: false, attempts: 1 };
  }
}

/**
 * Clear failed login attempts (after successful login)
 */
export async function clearFailedLoginAttempts(ip: string): Promise<void> {
  const key = `${FAILED_LOGIN_KEY_PREFIX}${ip}`;
  try {
    await cacheRedis.del(key);
    console.log(`Cleared failed login attempts for IP: ${ip}`);
  } catch (error) {
    console.error('Failed to clear login attempts:', error);
  }
}

/**
 * Log security event to Redis and console
 */
export async function logSecurityEvent(event: SecurityEvent): Promise<void> {
  try {
    // Store in Redis list (keep last 1000 events)
    await cacheRedis.lpush(SECURITY_EVENTS_KEY, JSON.stringify(event));
    await cacheRedis.ltrim(SECURITY_EVENTS_KEY, 0, 999);
    
    // Log to console with appropriate level
    const logMessage = `SECURITY [${event.severity.toUpperCase()}] ${event.type}: ${JSON.stringify(event.data)}`;
    
    switch (event.severity) {
      case 'critical':
        console.error(`🚨 ${logMessage}`);
        break;
      case 'high':
        console.error(`⚠️ ${logMessage}`);
        break;
      case 'medium':
        console.warn(`⚡ ${logMessage}`);
        break;
      default:
        console.log(`ℹ️ ${logMessage}`);
    }
    
    // In production, you might want to send to external monitoring
    if (process.env.NODE_ENV === 'production' && event.severity === 'critical') {
      // TODO: Send to PagerDuty, Slack, etc.
    }
    
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
}

/**
 * Handle security alerts (e.g., send notifications)
 */
async function handleSecurityAlert(event: SecurityEvent): Promise<void> {
  console.error(`🚨 SECURITY ALERT: ${event.type} detected from ${event.data.ip}`);
  
  // TODO: Implement alert mechanisms
  // - Send email to security team
  // - Create ticket in security system
  // - Temporarily block IP
  // - Add to firewall rules
  
  // For now, just log the alert
  const alertData = {
    ...event,
    alertType: 'security_breach',
    requiresAction: true,
  };
  
  await cacheRedis.lpush(`${SECURITY_EVENTS_KEY}:alerts`, JSON.stringify(alertData));
  await cacheRedis.ltrim(`${SECURITY_EVENTS_KEY}:alerts`, 0, 99);
}

/**
 * Get recent security events
 */
export async function getRecentSecurityEvents(
  limit: number = 50,
  severity?: string
): Promise<SecurityEvent[]> {
  try {
    const events = await cacheRedis.lrange(SECURITY_EVENTS_KEY, 0, limit - 1);
    const parsedEvents: SecurityEvent[] = events.map(event => JSON.parse(event));
    
    if (severity) {
      return parsedEvents.filter(event => event.severity === severity);
    }
    
    return parsedEvents;
  } catch (error) {
    console.error('Failed to get security events:', error);
    return [];
  }
}

/**
 * Get security statistics
 */
export async function getSecurityStats(): Promise<{
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsBySeverity: Record<string, number>;
  recentAlerts: number;
  activeBlockedIPs: number;
}> {
  try {
    const events = await getRecentSecurityEvents(1000);
    
    const eventsByType: Record<string, number> = {};
    const eventsBySeverity: Record<string, number> = {};
    
    events.forEach(event => {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
      eventsBySeverity[event.severity] = (eventsBySeverity[event.severity] || 0) + 1;
    });
    
    // Get recent alerts
    const alerts = await cacheRedis.lrange(`${SECURITY_EVENTS_KEY}:alerts`, 0, -1);
    
    // Get currently blocked IPs
    const blockedIPs = await cacheRedis.keys(`${FAILED_LOGIN_KEY_PREFIX}*`);
    const activeBlockedIPs = blockedIPs.length;
    
    return {
      totalEvents: events.length,
      eventsByType,
      eventsBySeverity,
      recentAlerts: alerts.length,
      activeBlockedIPs,
    };
    
  } catch (error) {
    console.error('Failed to get security stats:', error);
    return {
      totalEvents: 0,
      eventsByType: {},
      eventsBySeverity: {},
      recentAlerts: 0,
      activeBlockedIPs: 0,
    };
  }
}

/**
 * Check if IP is currently blocked
 */
export async function isIPBlocked(ip: string): Promise<boolean> {
  try {
    const key = `${FAILED_LOGIN_KEY_PREFIX}${ip}`;
    const data = await cacheRedis.get(key);
    
    if (!data) return false;
    
    const attemptData: FailedLoginAttempt = JSON.parse(data);
    return attemptData.attempts >= SECURITY_ALERT_THRESHOLD;
    
  } catch (error) {
    console.error('Failed to check IP block status:', error);
    return false;
  }
}

/**
 * Manually block an IP
 */
export async function blockIP(
  ip: string,
  reason: string,
  durationMinutes: number = 60
): Promise<void> {
  try {
    const blockData = {
      ip,
      reason,
      blockedAt: new Date(),
      blockedUntil: new Date(Date.now() + durationMinutes * 60 * 1000),
      manual: true,
    };
    
    const blockKey = `docuchat:manual_block:${ip}`;
    await cacheRedis.setex(blockKey, durationMinutes * 60, JSON.stringify(blockData));
    
    const event: SecurityEvent = {
      id: crypto.randomUUID(),
      type: 'manual_ip_block',
      severity: 'high',
      timestamp: new Date(),
      data: blockData,
    };
    
    await logSecurityEvent(event);
    console.log(`Manually blocked IP ${ip} for ${durationMinutes} minutes. Reason: ${reason}`);
    
  } catch (error) {
    console.error('Failed to block IP:', error);
  }
}

/**
 * Get blocked IPs
 */
export async function getBlockedIPs(): Promise<Array<{
  ip: string;
  reason?: string;
  attempts?: number;
  blockedUntil?: Date;
  manual?: boolean;
}>> {
  try {
    const blockedIPs: Array<{
      ip: string;
      reason?: string;
      attempts?: number;
      blockedUntil?: Date;
      manual?: boolean;
    }> = [];
    
    // Get automatic blocks (failed logins)
    const autoBlocks = await cacheRedis.keys(`${FAILED_LOGIN_KEY_PREFIX}*`);
    for (const key of autoBlocks) {
      const data = await cacheRedis.get(key);
      if (data) {
        const attemptData: FailedLoginAttempt = JSON.parse(data);
        if (attemptData.attempts >= SECURITY_ALERT_THRESHOLD) {
          blockedIPs.push({
            ip: attemptData.ip,
            attempts: attemptData.attempts,
            blockedUntil: new Date(attemptData.lastAttempt.getTime() + FAILED_LOGIN_WINDOW * 1000),
            manual: false,
          });
        }
      }
    }
    
    // Get manual blocks
    const manualBlocks = await cacheRedis.keys(`docuchat:manual_block:*`);
    for (const key of manualBlocks) {
      const data = await cacheRedis.get(key);
      if (data) {
        const blockData = JSON.parse(data);
        blockedIPs.push({
          ip: blockData.ip,
          reason: blockData.reason,
          blockedUntil: new Date(blockData.blockedUntil),
          manual: true,
        });
      }
    }
    
    return blockedIPs;
    
  } catch (error) {
    console.error('Failed to get blocked IPs:', error);
    return [];
  }
}

export default {
  trackFailedLoginAttempt,
  clearFailedLoginAttempts,
  logSecurityEvent,
  getRecentSecurityEvents,
  getSecurityStats,
  isIPBlocked,
  blockIP,
  getBlockedIPs,
};
