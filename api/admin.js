/**
 * api/admin.js - 班务网页后台管理系统 Serverless Function
 * 实现开发者专用的完整系统管理功能，包括配置管理、监控、审计和维护工具
 * 部署于 Vercel Serverless Functions (/api/admin)
 */

import { v4 as uuidv4 } from 'uuid';

// 模拟数据库连接（实际应替换为 MongoDB/Supabase 等）
const db = {
  system_config: {},
  llm_configs: {},
  settings: {},
  backup_records: [],
  admin_logs: []
};

// CORS 头部配置
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// 错误响应构造函数
const createError = (message, statusCode = 400) => ({
  statusCode,
  headers: corsHeaders,
  body: JSON.stringify({ error: message })
});

// 成功响应构造函数
const createSuccess = (data, statusCode = 200) => ({
  statusCode,
  headers: corsHeaders,
  body: JSON.stringify(data)
});

// 敏感信息脱敏处理
const SENSITIVE_FIELDS = ['API_KEY', 'SECRET', 'PASSWORD', 'JWT'];

/**
 * 身份验证中间件：验证 JWT 令牌并检查管理员权限
 * @param {Object} event - API Gateway 事件对象
 * @returns {Object|null} 解析后的用户信息或错误响应
 */
async function authenticate(event) {
  try {
    const authHeader = event.headers.Authorization || event.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return createError('未提供身份验证令牌', 401);
    }

    const token = authHeader.split(' ')[1];
    // 实际应用中应使用 jwt.verify(token, JWT_SECRET) 进行验证
    // 此处模拟解析
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    
    // 查找用户
    const user = db.users?.find(u => u.user_id === payload.user_id && u.status === 'active');
    if (!user) {
      return createError('用户不存在或已被禁用', 403);
    }

    // 仅允许 admin 角色访问
    if (user.role !== 'admin') {
      return createError('权限不足，仅开发者可访问此接口', 403);
    }

    return { user };
  } catch (err) {
    console.error('认证失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * 记录操作日志
 * @param {string} operatorId - 操作者ID
 * @param {string} action - 操作类型
 * @param {string} target - 目标对象
 * @param {Object} details - 详细信息
 */
function logAudit(operatorId, action, target, details = {}) {
  const logEntry = {
    log_id: uuidv4(),
    timestamp: new Date().toISOString(),
    operator_id: operatorId,
    action,
    target,
    details,
    ip: '模拟IP' // 实际应从 event 获取
  };
  
  // 存储到数据库
  db.admin_logs.push(logEntry);
  
  // 输出日志
  console.log('[AUDIT LOG]', logEntry);
}

/**
 * 数据脱敏处理
 * @param {Object} data - 原始数据
 * @returns {Object} 脱敏后的数据
 */
function sanitizeData(data) {
  if (!data) return data;
  
  const result = Array.isArray(data) ? [...data] : { ...data };
  
  for (const key in result) {
    if (typeof result[key] === 'object' && result[key] !== null) {
      result[key] = sanitizeData(result[key]);
    } else if (SENSITIVE_FIELDS.some(field => key.toUpperCase().includes(field))) {
      result[key] = '[REDACTED]';
    }
  }
  
  return result;
}

/**
 * GET /api/admin/config - 获取当前系统配置
 */
export async function getConfig(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    logAudit(authResult.user.user_id, 'READ_CONFIG', 'system_config', { action: 'get_all' });

    return createSuccess({
      data: db.system_config,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('获取系统配置失败:', err);
    return createError('无法获取系统配置', 500);
  }
}

/**
 * PUT /api/admin/config - 更新系统配置
 */
export async function updateConfig(event) {
  if (event.httpMethod !== 'PUT') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const configData = JSON.parse(event.body || '{}');

    // 基本验证
    if (!configData || Object.keys(configData).length === 0) {
      return createError('配置数据不能为空', 400);
    }

    // 合并配置
    db.system_config = { ...db.system_config, ...configData };

    // 记录审计日志
    logAudit(authResult.user.user_id, 'UPDATE_CONFIG', 'system_config', { 
      updated_keys: Object.keys(configData),
      sanitized_data: sanitizeData(configData)
    });

    return createSuccess({
      message: '系统配置更新成功',
      updated_keys: Object.keys(configData),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('更新系统配置失败:', err);
    return createError('无法更新系统配置', 500);
  }
}

/**
 * GET /api/admin/config/{key} - 获取特定配置项
 */
export async function getConfigByKey(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { key } = event.pathParameters || {};
    if (!key) {
      return createError('缺少配置项键名', 400);
    }

    const value = db.system_config[key];

    if (value === undefined) {
      return createError(`配置项 "${key}" 不存在`, 404);
    }

    logAudit(authResult.user.user_id, 'READ_CONFIG', `system_config.${key}`, { key });

    return createSuccess({
      key,
      value: SENSITIVE_FIELDS.some(field => key.toUpperCase().includes(field)) ? '[REDACTED]' : value,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('获取特定配置项失败:', err);
    return createError('无法获取配置项', 500);
  }
}

/**
 * PUT /api/admin/config/{key} - 更新特定配置项
 */
export async function updateConfigByKey(event) {
  if (event.httpMethod !== 'PUT') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { key } = event.pathParameters || {};
    if (!key) {
      return createError('缺少配置项键名', 400);
    }

    const { value } = JSON.parse(event.body || '{}');
    if (value === undefined) {
      return createError('缺少配置值', 400);
    }

    // 保存旧值用于日志记录
    const oldValue = db.system_config[key];

    db.system_config[key] = value;

    logAudit(authResult.user.user_id, 'UPDATE_CONFIG', `system_config.${key}`, { 
      key, 
      old_value: SENSITIVE_FIELDS.some(field => key.toUpperCase().includes(field)) ? '[REDACTED]' : oldValue,
      new_value: SENSITIVE_FIELDS.some(field => key.toUpperCase().includes(field)) ? '[REDACTED]' : value
    });

    return createSuccess({
      message: `配置项 "${key}" 更新成功`,
      key,
      value: SENSITIVE_FIELDS.some(field => key.toUpperCase().includes(field)) ? '[REDACTED]' : value,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('更新特定配置项失败:', err);
    return createError('无法更新配置项', 500);
  }
}

/**
 * GET /api/admin/llm-config - 获取LLM配置信息
 */
export async function getLlmConfig(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    logAudit(authResult.user.user_id, 'READ_CONFIG', 'llm_configs', { action: 'get_all' });

    return createSuccess({
      data: sanitizeData(db.llm_configs),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('获取LLM配置失败:', err);
    return createError('无法获取LLM配置', 500);
  }
}

/**
 * POST /api/admin/llm-config - 配置LLM服务参数
 */
export async function setLlmConfig(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const configData = JSON.parse(event.body || '{}');

    // 验证必要字段
    if (!configData.api_key) {
      return createError('LLM API密钥不能为空', 400);
    }

    if (!configData.model || !configData.provider) {
      return createError('必须指定模型名称和提供商', 400);
    }

    // 保存配置
    db.llm_configs = { ...configData, last_updated: new Date().toISOString() };

    logAudit(authResult.user.user_id, 'UPDATE_CONFIG', 'llm_configs', { 
      provider: configData.provider,
      model: configData.model,
      has_api_key: !!configData.api_key
    });

    return createSuccess({
      message: 'LLM服务配置成功',
      provider: configData.provider,
      model: configData.model,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('配置LLM服务失败:', err);
    return createError('无法配置LLM服务', 500);
  }
}

/**
 * PUT /api/admin/llm-config/{model} - 更新特定LLM模型配置
 */
export async function updateLlmModelConfig(event) {
  if (event.httpMethod !== 'PUT') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { model } = event.pathParameters || {};
    if (!model) {
      return createError('缺少模型名称', 400);
    }

    const modelConfig = JSON.parse(event.body || '{}');
    if (!modelConfig) {
      return createError('配置数据不能为空', 400);
    }

    // 如果是主配置，则更新整个配置
    if (!db.llm_configs.models) {
      db.llm_configs.models = {};
    }

    db.llm_configs.models[model] = { 
      ...db.llm_configs.models[model], 
      ...modelConfig, 
      updated_at: new Date().toISOString() 
    };

    logAudit(authResult.user.user_id, 'UPDATE_CONFIG', `llm_configs.models.${model}`, { 
      model, 
      updated_fields: Object.keys(modelConfig),
      sanitized_config: sanitizeData(modelConfig)
    });

    return createSuccess({
      message: `LLM模型 ${model} 配置更新成功`,
      model,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('更新LLM模型配置失败:', err);
    return createError('无法更新LLM模型配置', 500);
  }
}

/**
 * GET /api/admin/llm-usage - 获取LLM API使用统计和配额信息
 */
export async function getLlmUsage(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    // 模拟使用统计数据
    const usageStats = {
      total_requests: 15872,
      successful_requests: 15801,
      failed_requests: 71,
      tokens_used: {
        prompt: 2345678,
        completion: 1234567,
        total: 3580245
      },
      cost_estimate: {
        currency: 'USD',
        amount: 45.67
      },
      rate_limits: {
        current: 158,
        limit: 200,
        reset_time: new Date(Date.now() + 3600000).toISOString() // 1小时后重置
      },
      daily_usage: [
        { date: '2026-03-17', requests: 1200 },
        { date: '2026-03-18', requests: 1450 },
        { date: '2026-03-19', requests: 1600 },
        { date: '2026-03-20', requests: 1800 },
        { date: '2026-03-21', requests: 1750 },
        { date: '2026-03-22', requests: 1900 },
        { date: '2026-03-23', requests: 1500 }
      ]
    };

    logAudit(authResult.user.user_id, 'READ_STATS', 'llm_usage', { action: 'get_usage' });

    return createSuccess(usageStats);
  } catch (err) {
    console.error('获取LLM使用情况失败:', err);
    return createError('无法获取LLM使用统计', 500);
  }
}

/**
 * GET /api/admin/settings - 获取所有系统参数
 */
export async function getSettings(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    logAudit(authResult.user.user_id, 'READ_CONFIG', 'settings', { action: 'get_all' });

    return createSuccess({
      data: db.settings,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('获取系统参数失败:', err);
    return createError('无法获取系统参数', 500);
  }
}

/**
 * PUT /api/admin/settings - 批量更新系统参数
 */
export async function updateSettings(event) {
  if (event.httpMethod !== 'PUT') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const settingsData = JSON.parse(event.body || '{}');

    if (!settingsData || Object.keys(settingsData).length === 0) {
      return createError('参数数据不能为空', 400);
    }

    // 合并设置
    db.settings = { ...db.settings, ...settingsData };

    // 模拟热更新生效
    console.log('热更新系统参数:', Object.keys(settingsData));

    logAudit(authResult.user.user_id, 'UPDATE_CONFIG', 'settings', { 
      updated_keys: Object.keys(settingsData),
      count: Object.keys(settingsData).length
    });

    return createSuccess({
      message: '系统参数更新成功，已热更新生效',
      updated_keys: Object.keys(settingsData),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('更新系统参数失败:', err);
    return createError('无法更新系统参数', 500);
  }
}

/**
 * GET /api/admin/settings/{category} - 获取特定类别参数
 */
export async function getSettingsByCategory(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { category } = event.pathParameters || {};
    if (!category) {
      return createError('缺少参数类别', 400);
    }

    const categorySettings = {};
    for (const [key, value] of Object.entries(db.settings)) {
      if (key.startsWith(`${category}.`) || key === category) {
        categorySettings[key] = value;
      }
    }

    if (Object.keys(categorySettings).length === 0) {
      return createError(`类别 "${category}" 下无配置参数`, 404);
    }

    logAudit(authResult.user.user_id, 'READ_CONFIG', `settings.${category}`, { category });

    return createSuccess({
      category,
      data: categorySettings,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('获取类别参数失败:', err);
    return createError('无法获取参数', 500);
  }
}

/**
 * PUT /api/admin/settings/{category}/{key} - 更新单个参数
 */
export async function updateSetting(event) {
  if (event.httpMethod !== 'PUT') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { category, key } = event.pathParameters || {};
    if (!category || !key) {
      return createError('缺少参数类别或键名', 400);
    }

    const { value } = JSON.parse(event.body || '{}');
    if (value === undefined) {
      return createError('缺少参数值', 400);
    }

    const fullKey = `${category}.${key}`;
    const oldValue = db.settings[fullKey];

    db.settings[fullKey] = value;

    // 模拟热更新
    console.log(`热更新参数: ${fullKey} = ${value}`);

    logAudit(authResult.user.user_id, 'UPDATE_CONFIG', `settings.${fullKey}`, { 
      key: fullKey, 
      old_value: oldValue,
      new_value: value
    });

    return createSuccess({
      message: `参数 "${fullKey}" 更新成功`,
      key: fullKey,
      value,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('更新参数失败:', err);
    return createError('无法更新参数', 500);
  }
}

/**
 * GET /api/admin/dashboard - 获取实时仪表盘数据
 */
export async function getDashboard(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const dashboardData = {
      summary: {
        total_users: 128,
        active_users: 45,
        online_users: 23,
        total_tasks: 24,
        pending_submissions: 156,
        items_borrowed: 18
      },
      charts: {
        user_activity: [
          { hour: '00:00', users: 12 },
          { hour: '04:00', users: 8 },
          { hour: '08:00', users: 23 },
          { hour: '12:00', users: 38 },
          { hour: '16:00', users: 45 },
          { hour: '20:00', users: 32 },
          { hour: '24:00', users: 18 }
        ],
        api_calls: [
          { day: '周一', calls: 1250 },
          { day: '周二', calls: 1420 },
          { day: '周三', calls: 1380 },
          { day: '周四', calls: 1560 },
          { day: '周五', calls: 1890 },
          { day: '周六', calls: 980 },
          { day: '周日', calls: 760 }
        ],
        task_completion: [
          { task: '作业收集', completed: 89, total: 120 },
          { task: '物资借用', completed: 45, total: 60 },
          { task: '课程反馈', completed: 112, total: 150 }
        ]
      },
      recent_activities: [
        { 
          id: uuidv4(), 
          type: 'task_created', 
          description: '创建了新的作业收集任务 "高数作业第5次"',
          timestamp: new Date(Date.now() - 300000).toISOString(), // 5分钟前
          user: '张三'
        },
        { 
          id: uuidv4(), 
          type: 'item_borrowed', 
          description: '李四借用了班级相机',
          timestamp: new Date(Date.now() - 1800000).toISOString(), // 30分钟前
          user: '李四'
        },
        { 
          id: uuidv4(), 
          type: 'config_updated', 
          description: '更新了系统参数 file_upload_limit',
          timestamp: new Date(Date.now() - 7200000).toISOString(), // 2小时前
          user: '王五'
        }
      ]
    };

    logAudit(authResult.user.user_id, 'READ_DASHBOARD', 'dashboard', { action: 'view' });

    return createSuccess(dashboardData);
  } catch (err) {
    console.error('获取仪表盘数据失败:', err);
    return createError('无法获取仪表盘数据', 500);
  }
}

/**
 * GET /api/admin/metrics - 获取系统性能指标
 */
export async function getMetrics(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    // 模拟系统指标数据
    const metricsData = {
      cpu: {
        usage_percent: 34.5,
        cores: 4,
        load_1m: 0.45,
        load_5m: 0.38,
        load_15m: 0.32
      },
      memory: {
        used_mb: 1248,
        total_mb: 4096,
        usage_percent: 30.4,
        free_mb: 2848
      },
      storage: {
        used_gb: 125.6,
        total_gb: 500,
        usage_percent: 25.1,
        available_gb: 374.4
      },
      network: {
        incoming_kbps: 1250,
        outgoing_kbps: 890,
        connections: 45
      },
      process: {
        uptime_seconds: 86400,
        node_version: 'v18.17.0',
        memory_heap_used: 156
      }
    };

    logAudit(authResult.user.user_id, 'READ_METRICS', 'system_metrics', { action: 'get' });

    return createSuccess(metricsData);
  } catch (err) {
    console.error('获取性能指标失败:', err);
    return createError('无法获取系统性能指标', 500);
  }
}

/**
 * GET /api/admin/users/stats - 获取用户活跃度统计
 */
export async function getUserStats(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const userStats = {
      total: 128,
      by_role: [
        { role: 'student', count: 110, percentage: 85.9 },
        { role: 'monitor', count: 15, percentage: 11.7 },
        { role: 'admin', count: 3, percentage: 2.4 }
      ],
      activity: {
        today: 45,
        this_week: 89,
        this_month: 112
      },
      login_frequency: [
        { range: '每日登录', count: 28, percentage: 21.9 },
        { range: '每周几次', count: 65, percentage: 50.8 },
        { range: '每月几次', count: 30, percentage: 23.4 },
        { range: '很少登录', count: 5, percentage: 3.9 }
      ],
      retention: {
        day_1: 78.5,
        day_7: 62.3,
        day_30: 45.1
      }
    };

    logAudit(authResult.user.user_id, 'READ_STATS', 'user_stats', { action: 'get' });

    return createSuccess(userStats);
  } catch (err) {
    console.error('获取用户统计失败:', err);
    return createError('无法获取用户活跃度统计', 500);
  }
}

/**
 * GET /api/admin/api/stats - 获取API调用频率统计
 */
export async function getApiStats(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const apiStats = {
      total_calls: 24567,
      success_rate: 98.5,
      by_endpoint: [
        { endpoint: '/api/courses', calls: 8900, errors: 120 },
        { endpoint: '/api/tasks', calls: 7650, errors: 95 },
        { endpoint: '/api/items', calls: 4320, errors: 67 },
        { endpoint: '/api/documents', calls: 2100, errors: 34 },
        { endpoint: '/api/llm', calls: 1597, errors: 120 }
      ],
      by_method: [
        { method: 'GET', calls: 18000 },
        { method: 'POST', calls: 5200 },
        { method: 'PUT', calls: 980 },
        { method: 'DELETE', calls: 387 }
      ],
      response_time: {
        p50: 120,
        p90: 280,
        p99: 520,
        max: 1500
      },
      hourly_distribution: [
        { hour: 0, calls: 850 }, { hour: 1, calls: 620 }, { hour: 2, calls: 480 }, { hour: 3, calls: 320 },
        { hour: 4, calls: 410 }, { hour: 5, calls: 780 }, { hour: 6, calls: 1250 }, { hour: 7, calls: 1890 },
        { hour: 8, calls: 2450 }, { hour: 9, calls: 2890 }, { hour: 10, calls: 3120 }, { hour: 11, calls: 3050 },
        { hour: 12, calls: 2980 }, { hour: 13, calls: 2760 }, { hour: 14, calls: 2840 }, { hour: 15, calls: 3020 },
        { hour: 16, calls: 3210 }, { hour: 17, calls: 3350 }, { hour: 18, calls: 3180 }, { hour: 19, calls: 2940 },
        { hour: 20, calls: 2670 }, { hour: 21, calls: 2340 }, { hour: 22, calls: 1980 }, { hour: 23, calls: 1560 }
      ]
    };

    logAudit(authResult.user.user_id, 'READ_STATS', 'api_stats', { action: 'get' });

    return createSuccess(apiStats);
  } catch (err) {
    console.error('获取API统计失败:', err);
    return createError('无法获取API调用统计', 500);
  }
}

/**
 * GET /api/admin/health - 获取外部服务健康状态
 */
export async function getHealthStatus(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    // 模拟服务健康检查
    const healthStatus = {
      services: [
        {
          name: 'Database',
          status: 'healthy',
          response_time_ms: 12,
          details: 'MongoDB replica set is operational'
        },
        {
          name: 'File Storage',
          status: 'healthy',
          response_time_ms: 23,
          details: 'OSS bucket is accessible'
        },
        {
          name: 'LLM Service',
          status: 'healthy',
          response_time_ms: 450,
          details: 'OpenAI API is responding normally'
        },
        {
          name: 'Email Service',
          status: 'degraded',
          response_time_ms: 1200,
          details: 'SMTP server delayed responses'
        },
        {
          name: 'Cache Service',
          status: 'healthy',
          response_time_ms: 8,
          details: 'Redis instance is running'
        }
      ],
      overall_status: 'operational',
      checked_at: new Date().toISOString()
    };

    logAudit(authResult.user.user_id, 'HEALTH_CHECK', 'external_services', { action: 'check_all' });

    return createSuccess(healthStatus);
  } catch (err) {
    console.error('获取健康状态失败:', err);
    return createError('无法获取服务健康状态', 500);
  }
}

/**
 * GET /api/admin/audit-logs - 获取审计日志列表
 */
export async function getAuditLogs(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { page = 1, limit = 20, action, operator, start_date, end_date } = event.queryStringParameters || {};

    let filteredLogs = [...db.admin_logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // 应用筛选条件
    if (action) {
      filteredLogs = filteredLogs.filter(log => log.action === action);
    }
    if (operator) {
      filteredLogs = filteredLogs.filter(log => log.operator_id === operator);
    }
    if (start_date) {
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) >= new Date(start_date));
    }
    if (end_date) {
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) <= new Date(end_date));
    }

    // 分页
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginatedLogs = filteredLogs.slice(skip, skip + parseInt(limit));

    logAudit(authResult.user.user_id, 'READ_LOGS', 'audit_logs', { 
      action: 'list',
      filters: { action, operator, start_date, end_date },
      pagination: { page: parseInt(page), limit: parseInt(limit), total: filteredLogs.length }
    });

    return createSuccess({
      data: paginatedLogs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: filteredLogs.length,
        pages: Math.ceil(filteredLogs.length / parseInt(limit))
      },
      filters: { action, operator, start_date, end_date }
    });
  } catch (err) {
    console.error('获取审计日志失败:', err);
    return createError('无法获取审计日志', 500);
  }
}

/**
 * GET /api/admin/audit-logs/{log_id} - 获取单个审计日志详情
 */
export async function getAuditLogById(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { log_id } = event.pathParameters || {};
    if (!log_id) {
      return createError('缺少日志ID', 400);
    }

    const log = db.admin_logs.find(l => l.log_id === log_id);

    if (!log) {
      return createError('审计日志不存在', 404);
    }

    logAudit(authResult.user.user_id, 'READ_LOGS', `audit_logs.${log_id}`, { log_id });

    return createSuccess(log);
  } catch (err) {
    console.error('获取审计日志详情失败:', err);
    return createError('无法获取审计日志详情', 500);
  }
}

/**
 * POST /api/admin/audit-logs/search - 高级搜索审计日志
 */
export async function searchAuditLogs(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const searchData = JSON.parse(event.body || '{}');
    const { query, actions = [], operators = [], date_range = {} } = searchData;

    let filteredLogs = [...db.admin_logs];

    // 文本搜索
    if (query) {
      filteredLogs = filteredLogs.filter(log => 
        log.action.includes(query) || 
        log.target.includes(query) ||
        JSON.stringify(log.details).includes(query)
      );
    }

    // 按操作类型筛选
    if (actions.length > 0) {
      filteredLogs = filteredLogs.filter(log => actions.includes(log.action));
    }

    // 按操作者筛选
    if (operators.length > 0) {
      filteredLogs = filteredLogs.filter(log => operators.includes(log.operator_id));
    }

    // 按时间范围筛选
    if (date_range.start) {
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) >= new Date(date_range.start));
    }
    if (date_range.end) {
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) <= new Date(date_range.end));
    }

    // 排序
    filteredLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    logAudit(authResult.user.user_id, 'SEARCH_LOGS', 'audit_logs', { 
      query,
      filters: { actions, operators, date_range },
      results_count: filteredLogs.length
    });

    return createSuccess({
      data: filteredLogs,
      total: filteredLogs.length,
      query: searchData
    });
  } catch (err) {
    console.error('搜索审计日志失败:', err);
    return createError('无法搜索审计日志', 500);
  }
}

/**
 * POST /api/admin/audit-logs/export - 导出审计日志为CSV格式
 */
export async function exportAuditLogs(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const exportData = JSON.parse(event.body || '{}');
    const { format = 'csv', include_details = false } = exportData;

    // 准备CSV数据
    const csvRows = [];
    const headerRow = ['时间戳', '操作者ID', '操作类型', '目标对象'];
    if (include_details) {
      headerRow.push('详细信息');
    }
    csvRows.push(headerRow.join(','));

    // 添加数据行
    for (const log of db.admin_logs) {
      const row = [
        `"${log.timestamp}"`,
        `"${log.operator_id}"`,
        `"${log.action}"`,
        `"${log.target}"`
      ];
      if (include_details) {
        row.push(`"${JSON.stringify(log.details)}"`);
      }
      csvRows.push(row.join(','));
    }

    const csvContent = csvRows.join('\n');

    // 创建下载响应
    logAudit(authResult.user.user_id, 'EXPORT_DATA', 'audit_logs', { 
      format,
      include_details,
      record_count: db.admin_logs.length
    });

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="audit_logs_export.csv"'
      },
      body: csvContent
    };
  } catch (err) {
    console.error('导出审计日志失败:', err);
    return createError('无法导出审计日志', 500);
  }
}

/**
 * POST /api/admin/users - 创建新用户账号
 */
export async function createUser(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const userData = JSON.parse(event.body || '{}');

    // 支持批量创建
    const usersToCreate = Array.isArray(userData) ? userData : [userData];
    const results = [];

    for (const user of usersToCreate) {
      // 生成唯一ID和初始密码
      const userId = uuidv4();
      const tempPassword = Math.random().toString(36).substring(2, 10); // 8位随机密码

      const newUser = {
        user_id: userId,
        username: user.username || `user_${userId.substring(0, 8)}`,
        password_hash: `hashed_${tempPassword}`, // 实际应用中应使用bcrypt加密
        role: user.role || 'student',
        profile: {
          nickname: user.nickname || '',
          gender: user.gender || '',
          is_member: user.is_member !== undefined ? user.is_member : true,
          custom_tags: user.custom_tags || []
        },
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_login: null
      };

      // 保存到数据库
      db.users.push(newUser);

      // 记录结果（不包含明文密码）
      results.push({
        user_id: userId,
        username: newUser.username,
        role: newUser.role,
        status: 'created',
        initial_password: tempPassword // 仅在响应中返回一次
      });

      // 记录审计日志
      logAudit(authResult.user.user_id, 'CREATE_USER', `users.${userId}`, { 
        role: newUser.role,
        username: newUser.username
      });
    }

    return createSuccess({
      message: `成功创建 ${results.length} 个用户`,
      results,
      total_created: results.length
    });
  } catch (err) {
    console.error('创建用户失败:', err);
    return createError('无法创建用户', 500);
  }
}

/**
 * DELETE /api/admin/users/{user_id} - 删除用户账号
 */
export async function deleteUser(event) {
  if (event.httpMethod !== 'DELETE') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { user_id } = event.pathParameters || {};
    if (!user_id) {
      return createError('缺少用户ID', 400);
    }

    // 查找用户
    const userIndex = db.users.findIndex(u => u.user_id === user_id);
    if (userIndex === -1) {
      return createError('用户不存在', 404);
    }

    const userToDelete = db.users[userIndex];

    // 不允许删除自己
    if (userToDelete.user_id === authResult.user.user_id) {
      return createError('不能删除自己的账号', 400);
    }

    // 软删除
    userToDelete.status = 'deleted';
    userToDelete.deleted_at = new Date().toISOString();

    logAudit(authResult.user.user_id, 'DELETE_USER', `users.${user_id}`, { 
      username: userToDelete.username,
      role: userToDelete.role
    });

    return createSuccess({
      message: '用户账号已删除（软删除）',
      user_id,
      deleted_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('删除用户失败:', err);
    return createError('无法删除用户', 500);
  }
}

/**
 * POST /api/admin/users/{user_id}/reset-password - 重置用户密码
 */
export async function resetUserPassword(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { user_id } = event.pathParameters || {};
    if (!user_id) {
      return createError('缺少用户ID', 400);
    }

    // 查找用户
    const user = db.users.find(u => u.user_id === user_id);
    if (!user) {
      return createError('用户不存在', 404);
    }

    // 生成新密码
    const newPassword = Math.random().toString(36).substring(2, 10); // 8位随机密码
    user.password_hash = `hashed_${newPassword}`; // 实际应用中应使用bcrypt加密
    user.updated_at = new Date().toISOString();

    logAudit(authResult.user.user_id, 'RESET_PASSWORD', `users.${user_id}`, { 
      username: user.username
    });

    return createSuccess({
      message: '用户密码已重置',
      user_id,
      new_password: newPassword, // 仅在响应中返回一次
      reset_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('重置密码失败:', err);
    return createError('无法重置密码', 500);
  }
}

/**
 * POST /api/admin/users/import - 批量导入用户数据（CSV格式）
 */
export async function importUsers(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    // 模拟文件上传处理
    const contentType = event.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return createError('请上传CSV文件', 400);
    }

    // 这里应该解析 multipart/form-data
    // 模拟导入过程
    const mockImportResults = {
      total_processed: 50,
      successfully_imported: 48,
      failed: 2,
      errors: [
        { line: 15, error: '邮箱格式无效' },
        { line: 23, error: '角色类型不支持' }
      ],
      duplicates: 3
    };

    logAudit(authResult.user.user_id, 'IMPORT_USERS', 'users', { 
      total: mockImportResults.total_processed,
      success: mockImportResults.successfully_imported,
      failed: mockImportResults.failed
    });

    return createSuccess({
      message: '用户数据导入完成',
      results: mockImportResults,
      imported_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('导入用户失败:', err);
    return createError('无法导入用户数据', 500);
  }
}

/**
 * POST /api/admin/users/export - 批量导出用户数据
 */
export async function exportUsers(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const exportData = JSON.parse(event.body || '{}');
    const { format = 'json', include_sensitive = false } = exportData;

    let exportUsers = db.users.filter(u => u.status !== 'deleted');

    // 准备导出数据
    let exportContent;
    let contentType;
    let filename;

    if (format === 'json') {
      // 过滤敏感信息
      const safeUsers = exportUsers.map(user => {
        const { password_hash, ...safeUser } = user;
        return safeUser;
      });

      exportContent = JSON.stringify(safeUsers, null, 2);
      contentType = 'application/json; charset=utf-8';
      filename = 'users_export.json';
    } else if (format === 'csv') {
      // 创建CSV
      const csvRows = [];
      const headerRow = ['用户ID', '用户名', '角色', '昵称', '性别', '团员', '标签', '状态', '创建时间'];
      csvRows.push(headerRow.join(','));

      for (const user of exportUsers) {
        const row = [
          `"${user.user_id}"`,
          `"${user.username}"`,
          `"${user.role}"`,
          `"${user.profile.nickname}"`,
          `"${user.profile.gender}"`,
          user.profile.is_member ? '是' : '否',
          `"${(user.profile.custom_tags || []).join(';')}"`,
          `"${user.status}"`,
          `"${user.created_at}"`
        ];
        csvRows.push(row.join(','));
      }

      exportContent = csvRows.join('\n');
      contentType = 'text/csv; charset=utf-8';
      filename = 'users_export.csv';
    } else {
      return createError('不支持的导出格式', 400);
    }

    logAudit(authResult.user.user_id, 'EXPORT_DATA', 'users', { 
      format,
      count: exportUsers.length,
      include_sensitive
    });

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`
      },
      body: exportContent
    };
  } catch (err) {
    console.error('导出用户失败:', err);
    return createError('无法导出用户数据', 500);
  }
}

/**
 * POST /api/admin/data/clean-cache - 清理系统缓存
 */
export async function cleanCache(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    // 模拟清理缓存
    console.log('正在清理系统缓存...');
    
    // 这里应该调用实际的缓存清理逻辑
    // 模拟清理过程
    const cleanedItems = [
      'redis_cache_key_1',
      'redis_cache_key_2',
      'session_store_abc',
      'query_result_xyz'
    ];

    logAudit(authResult.user.user_id, 'CLEAN_CACHE', 'cache', { 
      items_cleaned: cleanedItems.length
    });

    return createSuccess({
      message: '系统缓存清理完成',
      cleaned_items: cleanedItems.length,
      cleaned_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('清理缓存失败:', err);
    return createError('无法清理系统缓存', 500);
  }
}

/**
 * POST /api/admin/data/rebuild-index - 重建搜索索引
 */
export async function rebuildIndex(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    // 模拟重建索引过程
    console.log('正在重建搜索索引...');

    const indexStats = {
      documents_processed: 1256,
      tasks_indexed: 24,
      items_indexed: 89,
      courses_indexed: 15,
      intel_indexed: 234,
      duration_ms: 2345
    };

    logAudit(authResult.user.user_id, 'REBUILD_INDEX', 'search_index', indexStats);

    return createSuccess({
      message: '搜索索引重建完成',
      stats: indexStats,
      rebuilt_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('重建索引失败:', err);
    return createError('无法重建搜索索引', 500);
  }
}

/**
 * GET /api/admin/data/backup - 触发数据备份
 */
export async function triggerBackup(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    // 模拟备份过程
    console.log('正在触发数据备份...');

    const backupId = `bkp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const startTime = new Date().toISOString();

    // 模拟备份操作
    const backupRecord = {
      backup_id: backupId,
      started_at: startTime,
      status: 'in_progress',
      tables: ['users', 'tasks', 'items', 'courses', 'documents'],
      initiated_by: authResult.user.user_id
    };

    db.backup_records.push(backupRecord);

    // 在实际应用中，这里会启动异步备份任务
    // 模拟立即完成
    setTimeout(() => {
      const recordIndex = db.backup_records.findIndex(b => b.backup_id === backupId);
      if (recordIndex !== -1) {
        db.backup_records[recordIndex] = {
          ...db.backup_records[recordIndex],
          completed_at: new Date().toISOString(),
          status: 'completed',
          size_mb: 24.5,
          location: 'oss://backup-bucket/daily/'
        };
      }
    }, 1000);

    logAudit(authResult.user.user_id, 'TRIGGER_BACKUP', `backups.${backupId}`, { backup_id: backupId });

    return createSuccess({
      message: '数据备份已触发',
      backup_id: backupId,
      status: 'in_progress',
      started_at: startTime,
      note: '备份将在后台完成，可通过恢复点列表查看进度'
    });
  } catch (err) {
    console.error('触发备份失败:', err);
    return createError('无法触发数据备份', 500);
  }
}

/**
 * GET /api/admin/data/restore-points - 获取可用恢复点列表
 */
export async function getRestorePoints(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    // 模拟恢复点数据
    const restorePoints = [
      {
        backup_id: 'bkp_1742659200_abc123',
        created_at: '2026-03-22T00:00:00Z',
        size_mb: 24.5,
        status: 'completed',
        location: 'oss://backup-bucket/daily/',
        description: '每日自动备份'
      },
      {
        backup_id: 'bkp_1742572800_def456',
        created_at: '2026-03-21T00:00:00Z',
        size_mb: 23.8,
        status: 'completed',
        location: 'oss://backup-bucket/daily/',
        description: '每日自动备份'
      },
      {
        backup_id: 'bkp_1742486400_ghi789',
        created_at: '2026-03-20T00:00:00Z',
        size_mb: 24.1,
        status: 'completed',
        location: 'oss://backup-bucket/daily/',
        description: '每日自动备份'
      }
    ];

    logAudit(authResult.user.user_id, 'LIST_BACKUPS', 'restore_points', { count: restorePoints.length });

    return createSuccess({
      data: restorePoints,
      total: restorePoints.length,
      latest_backup: restorePoints[0]?.created_at
    });
  } catch (err) {
    console.error('获取恢复点失败:', err);
    return createError('无法获取恢复点列表', 500);
  }
}

/**
 * POST /api/admin/data/restore/{backup_id} - 从指定备份恢复数据
 */
export async function restoreFromBackup(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { backup_id } = event.pathParameters || {};
    if (!backup_id) {
      return createError('缺少备份ID', 400);
    }

    // 查找备份记录
    const backup = db.backup_records.find(b => b.backup_id === backup_id);
    if (!backup) {
      return createError('备份记录不存在', 404);
    }

    if (backup.status !== 'completed') {
      return createError(`无法从状态为 "${backup.status}" 的备份恢复`, 400);
    }

    // 模拟恢复过程
    console.log(`正在从备份 ${backup_id} 恢复数据...`);

    // 在实际应用中，这里会启动异步恢复任务
    // 模拟立即开始
    const restoreRecord = {
      restore_id: `rst_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      backup_id,
      initiated_at: new Date().toISOString(),
      initiated_by: authResult.user.user_id,
      status: 'in_progress',
      progress: 0
    };

    // 这里应该将恢复记录存储到数据库
    // 模拟恢复完成
    setTimeout(() => {
      restoreRecord.status = 'completed';
      restoreRecord.completed_at = new Date().toISOString();
      restoreRecord.progress = 100;
    }, 5000);

    logAudit(authResult.user.user_id, 'RESTORE_DATA', `backups.${backup_id}`, { backup_id });

    return createSuccess({
      message: '数据恢复已启动',
      restore_id: restoreRecord.restore_id,
      backup_id,
      status: 'in_progress',
      initiated_at: restoreRecord.initiated_at,
      note: '恢复过程可能需要几分钟，请耐心等待'
    });
  } catch (err) {
    console.error('恢复数据失败:', err);
    return createError('无法执行数据恢复', 500);
  }
}

/**
 * GET /api/admin/security/acl - 获取访问控制列表配置
 */
export async function getAcl(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    // 模拟ACL配置
    const aclConfig = {
      roles: {
        admin: {
          permissions: ['*'],
          description: '系统管理员，拥有所有权限'
        },
        monitor: {
          permissions: [
            'tasks:create',
            'tasks:edit',
            'tasks:delete',
            'items:manage',
            'documents:mark_important',
            'courses:verify_intel'
          ],
          description: '班委，可管理任务和物资'
        },
        student: {
          permissions: [
            'tasks:submit',
            'items:borrow',
            'items:return',
            'courses:post_intel',
            'documents:upload'
          ],
          description: '普通同学，可提交表单和共享物品'
        },
        guest: {
          permissions: [
            'tasks:view_public',
            'items:view',
            'courses:view'
          ],
          description: '游客，仅可浏览公开信息'
        }
      },
      resource_permissions: {
        'api/tasks': ['admin', 'monitor'],
        'api/items': ['admin', 'monitor', 'student'],
        'api/courses': ['admin', 'monitor', 'student', 'guest'],
        'api/documents': ['admin', 'monitor', 'student']
      }
    };

    logAudit(authResult.user.user_id, 'READ_CONFIG', 'acl', { action: 'get' });

    return createSuccess(aclConfig);
  } catch (err) {
    console.error('获取ACL失败:', err);
    return createError('无法获取访问控制列表', 500);
  }
}

/**
 * PUT /api/admin/security/acl - 更新访问控制列表
 */
export async function updateAcl(event) {
  if (event.httpMethod !== 'PUT') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const aclData = JSON.parse(event.body || '{}');

    if (!aclData.roles && !aclData.resource_permissions) {
      return createError('至少需要提供 roles 或 resource_permissions 配置', 400);
    }

    // 这里应该合并到现有ACL配置
    // 模拟更新
    console.log('更新ACL配置:', aclData);

    logAudit(authResult.user.user_id, 'UPDATE_CONFIG', 'acl', { 
      updated_sections: Object.keys(aclData),
      sanitized_data: sanitizeData(aclData)
    });

    return createSuccess({
      message: '访问控制列表更新成功',
      updated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('更新ACL失败:', err);
    return createError('无法更新访问控制列表', 500);
  }
}

/**
 * GET /api/admin/security/api-keys - 获取API密钥列表
 */
export async function getApiKeys(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    // 模拟API密钥数据
    const apiKeys = [
      {
        key_id: 'key_prod_12345',
        name: '生产环境前端',
        prefix: 'prod_frt',
        created_at: '2026-01-15T10:30:00Z',
        last_used: '2026-03-23T12:00:00Z',
        permissions: ['read'],
        status: 'active',
        expires_at: null
      },
      {
        key_id: 'key_dev_67890',
        name: '开发环境测试',
        prefix: 'dev_tst',
        created_at: '2026-02-20T15:45:00Z',
        last_used: '2026-03-22T18:30:00Z',
        permissions: ['read', 'write'],
        status: 'active',
        expires_at: '2026-06-20T15:45:00Z'
      }
    ];

    logAudit(authResult.user.user_id, 'READ_KEYS', 'api_keys', { count: apiKeys.length });

    return createSuccess({
      data: apiKeys,
      total: apiKeys.length
    });
  } catch (err) {
    console.error('获取API密钥失败:', err);
    return createError('无法获取API密钥列表', 500);
  }
}

/**
 * POST /api/admin/security/api-keys - 创建新API密钥
 */
export async function createApiKey(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const keyData = JSON.parse(event.body || '{}');

    if (!keyData.name) {
      return createError('API密钥名称不能为空', 400);
    }

    if (!keyData.permissions || !Array.isArray(keyData.permissions)) {
      return createError('权限必须是一个数组', 400);
    }

    // 生成密钥ID和密钥值
    const keyId = `key_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const keyValue = `sk_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;

    const newKey = {
      key_id: keyId,
      name: keyData.name,
      prefix: keyId.substring(0, 8),
      value: keyValue, // 实际存储时应加密
      created_at: new Date().toISOString(),
      last_used: null,
      permissions: keyData.permissions,
      status: 'active',
      expires_at: keyData.expires_at || null,
      metadata: keyData.metadata || {}
    };

    // 保存到数据库
    db.api_keys.push(newKey);

    logAudit(authResult.user.user_id, 'CREATE_KEY', `api_keys.${keyId}`, { 
      name: keyData.name,
      permissions: keyData.permissions
    });

    // 返回时不包含完整密钥值
    const { value, ...responseKey } = newKey;

    return createSuccess({
      message: 'API密钥创建成功',
      key: responseKey,
      secret: keyValue, // 仅在创建时返回一次
      note: '请妥善保管此密钥，页面刷新后将无法再次查看完整密钥'
    });
  } catch (err) {
    console.error('创建API密钥失败:', err);
    return createError('无法创建API密钥', 500);
  }
}

/**
 * DELETE /api/admin/security/api-keys/{key_id} - 禁用API密钥
 */
export async function disableApiKey(event) {
  if (event.httpMethod !== 'DELETE') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { key_id } = event.pathParameters || {};
    if (!key_id) {
      return createError('缺少密钥ID', 400);
    }

    // 查找密钥
    const key = db.api_keys.find(k => k.key_id === key_id);
    if (!key) {
      return createError('API密钥不存在', 404);
    }

    if (key.status === 'disabled') {
      return createError('API密钥已禁用', 400);
    }

    // 禁用密钥
    key.status = 'disabled';
    key.disabled_at = new Date().toISOString();

    logAudit(authResult.user.user_id, 'DISABLE_KEY', `api_keys.${key_id}`, { key_id });

    return createSuccess({
      message: 'API密钥已禁用',
      key_id,
      disabled_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('禁用API密钥失败:', err);
    return createError('无法禁用API密钥', 500);
  }
}

/**
 * GET /api/admin/diagnostics/services - 检查所有服务健康状态
 */
export async function checkServices(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    // 模拟服务健康检查
    const serviceChecks = {
      database: {
        name: 'Database',
        status: 'healthy',
        response_time_ms: 15,
        details: 'MongoDB connection established'
      },
      file_storage: {
        name: 'File Storage',
        status: 'healthy',
        response_time_ms: 28,
        details: 'OSS bucket accessible'
      },
      cache: {
        name: 'Cache Service',
        status: 'healthy',
        response_time_ms: 8,
        details: 'Redis connected and responsive'
      },
      llm_service: {
        name: 'LLM Service',
        status: 'healthy',
        response_time_ms: 420,
        details: 'OpenAI API responded with valid response'
      },
      email_service: {
        name: 'Email Service',
        status: 'degraded',
        response_time_ms: 1100,
        details: 'SMTP server accepting connections but slow'
      },
      search_index: {
        name: 'Search Index',
        status: 'healthy',
        response_time_ms: 12,
        details: 'Elasticsearch cluster green'
      }
    };

    logAudit(authResult.user.user_id, 'DIAGNOSTICS', 'service_health', { action: 'check_all' });

    return createSuccess({
      checks: serviceChecks,
      overall_status: Object.values(serviceChecks).every(s => s.status === 'healthy') ? 'healthy' : 'degraded',
      checked_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('服务健康检查失败:', err);
    return createError('无法执行服务健康检查', 500);
  }
}

/**
 * GET /api/admin/diagnostics/errors - 获取系统错误日志
 */
export async function getErrorLogs(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    // 模拟错误日志
    const errorLogs = [
      {
        id: 'err_1742658000_001',
        timestamp: '2026-03-23T11:40:00Z',
        level: 'error',
        service: 'api/tasks',
        message: 'Failed to parse form submission JSON',
        details: {
          request_id: 'req_abc123',
          user_id: 'usr_456',
          stack_trace: 'SyntaxError: Unexpected token < in JSON at position 0\n    at JSON.parse (<anonymous>)\n    at handler (/var/task/index.js:45:23)'
        }
      },
      {
        id: 'err_1742657400_002',
        timestamp: '2026-03-23T11:30:00Z',
        level: 'warning',
        service: 'api/llm',
        message: 'LLM API timeout exceeded',
        details: {
          request_id: 'req_def456',
          timeout: 30000,
          actual_duration: 32500
        }
      },
      {
        id: 'err_1742656800_003',
        timestamp: '2026-03-23T11:20:00Z',
        level: 'error',
        service: 'api/users',
        message: 'Database connection lost',
        details: {
          error_code: 'CONN_LOST',
          retry_count: 3
        }
      }
    ];

    logAudit(authResult.user.user_id, 'READ_LOGS', 'error_logs', { count: errorLogs.length });

    return createSuccess({
      data: errorLogs,
      total: errorLogs.length,
      levels: ['error', 'warning', 'info']
    });
  } catch (err) {
    console.error('获取错误日志失败:', err);
    return createError('无法获取系统错误日志', 500);
  }
}

/**
 * POST /api/admin/diagnostics/test-db - 测试数据库连接
 */
export async function testDbConnection(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    // 模拟数据库连接测试
    console.log('正在测试数据库连接...');

    // 模拟延迟
    await new Promise(resolve => setTimeout(resolve, 200));

    // 模拟成功连接
    const testResult = {
      status: 'success',
      response_time_ms: 18,
      details: 'Successfully connected to MongoDB cluster',
      server_info: {
        version: '6.0.12',
        host: 'cluster0-shard-00-00.example.mongodb.net',
        uptime: 86400
      },
      collections: ['users', 'tasks', 'items', 'courses', 'documents'],
      document_counts: {
        users: 128,
        tasks: 24,
        items: 89,
        courses: 15,
        documents: 234
      }
    };

    logAudit(authResult.user.user_id, 'DIAGNOSTICS', 'database_test', { status: 'success' });

    return createSuccess(testResult);
  } catch (err) {
    console.error('数据库连接测试失败:', err);
    return createError('数据库连接测试失败', 500);
  }
}

/**
 * POST /api/admin/diagnostics/test-oss - 测试OSS存储连接
 */
export async function testOssConnection(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    // 模拟OSS连接测试
    console.log('正在测试OSS存储连接...');

    // 模拟延迟
    await new Promise(resolve => setTimeout(resolve, 300));

    const testResult = {
      status: 'success',
      response_time_ms: 245,
      details: 'Successfully connected to Alibaba Cloud OSS',
      buckets: [
        {
          name: 'class-affairs-backup',
          region: 'cn-hangzhou',
          files: 125,
          total_size_mb: 245.6
        },
        {
          name: 'class-affairs-documents',
          region: 'cn-hangzhou',
          files: 234,
          total_size_mb: 189.3
        }
      ],
      permissions: ['read', 'write', 'delete'],
      endpoint: 'https://oss-cn-hangzhou.aliyuncs.com'
    };

    logAudit(authResult.user.user_id, 'DIAGNOSTICS', 'oss_test', { status: 'success' });

    return createSuccess(testResult);
  } catch (err) {
    console.error('OSS连接测试失败:', err);
    return createError('OSS存储连接测试失败', 500);
  }
}

/**
 * POST /api/admin/diagnostics/test-llm - 测试LLM API连接
 */
export async function testLlmConnection(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    // 模拟LLM API测试
    console.log('正在测试LLM API连接...');

    // 模拟延迟
    await new Promise(resolve => setTimeout(resolve, 800));

    const testResult = {
      status: 'success',
      response_time_ms: 780,
      details: 'Successfully communicated with OpenAI API',
      model: 'gpt-3.5-turbo',
      capabilities: ['chat', 'completions', 'embeddings'],
      test_query: 'Hello, are you working?',
      test_response: 'Yes, I am working properly. How can I help you today?'
    };

    logAudit(authResult.user.user_id, 'DIAGNOSTICS', 'llm_test', { 
      status: 'success',
      model: testResult.model
    });

    return createSuccess(testResult);
  } catch (err) {
    console.error('LLM连接测试失败:', err);
    return createError('LLM API连接测试失败', 500);
  }
}

// 主处理器函数
export default async function handler(event) {
  // 处理预检请求
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders };
  }

  // 提取路径并路由
  const path = event.path.replace('/api/admin', '');
  const method = event.httpMethod;

  // 路由映射
  const routes = {
    '/config': {
      GET: getConfig,
      PUT: updateConfig
    },
    '/config/{key}': {
      GET: getConfigByKey,
      PUT: updateConfigByKey
    },
    '/llm-config': {
      GET: getLlmConfig,
      POST: setLlmConfig
    },
    '/llm-config/{model}': {
      PUT: updateLlmModelConfig
    },
    '/llm-usage': {
      GET: getLlmUsage
    },
    '/settings': {
      GET: getSettings,
      PUT: updateSettings
    },
    '/settings/{category}': {
      GET: getSettingsByCategory
    },
    '/settings/{category}/{key}': {
      PUT: updateSetting
    },
    '/dashboard': {
      GET: getDashboard
    },
    '/metrics': {
      GET: getMetrics
    },
    '/users/stats': {
      GET: getUserStats
    },
    '/api/stats': {
      GET: getApiStats
    },
    '/health': {
      GET: getHealthStatus
    },
    '/audit-logs': {
      GET: getAuditLogs,
      POST: searchAuditLogs
    },
    '/audit-logs/export': {
      POST: exportAuditLogs
    },
    '/audit-logs/{log_id}': {
      GET: getAuditLogById
    },
    '/users': {
      POST: createUser
    },
    '/users/{user_id}': {
      DELETE: deleteUser
    },
    '/users/{user_id}/reset-password': {
      POST: resetUserPassword
    },
    '/users/import': {
      POST: importUsers
    },
    '/users/export': {
      POST: exportUsers
    },
    '/data/clean-cache': {
      POST: cleanCache
    },
    '/data/rebuild-index': {
      POST: rebuildIndex
    },
    '/data/backup': {
      GET: triggerBackup
    },
    '/data/restore-points': {
      GET: getRestorePoints
    },
    '/data/restore/{backup_id}': {
      POST: restoreFromBackup
    },
    '/security/acl': {
      GET: getAcl,
      PUT: updateAcl
    },
    '/security/api-keys': {
      GET: getApiKeys,
      POST: createApiKey
    },
    '/security/api-keys/{key_id}': {
      DELETE: disableApiKey
    },
    '/diagnostics/services': {
      GET: checkServices
    },
    '/diagnostics/errors': {
      GET: getErrorLogs
    },
    '/diagnostics/test-db': {
      POST: testDbConnection
    },
    '/diagnostics/test-oss': {
      POST: testOssConnection
    },
    '/diagnostics/test-llm': {
      POST: testLlmConnection
    }
  };

  // 匹配路由
  const routeKey = Object.keys(routes).find(key => {
    if (key === path) return true;
    if (key.includes('{')) {
      const regex = new RegExp(`^${key.replace(/{[^}]+}/g, '[^/]+')}$`);
      return regex.test(path);
    }
    return false;
  });

  if (!routeKey) {
    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: '接口未找到' }) };
  }

  const methodHandler = routes[routeKey][method];
  if (!methodHandler) {
    return { statusCode: 405, headers: corsHeaders };
  }

  // 提取路径参数
  if (routeKey.includes('{')) {
    const pathParts = path.split('/');
    const routeParts = routeKey.split('/');
    const pathParams = {};
    
    routeParts.forEach((part, i) => {
      if (part.startsWith('{') && part.endsWith('}')) {
        const paramName = part.slice(1, -1);
        pathParams[paramName] = pathParts[i];
      }
    });
    
    event.pathParameters = pathParams;
  }

  // 调用处理函数
  return await methodHandler(event);
}