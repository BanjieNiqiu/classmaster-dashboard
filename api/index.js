/**
 * api/index.js - 统双班务网页 Serverless Functions 主入口文件
 * 统一入口：将 /api 下的请求按前缀分发到各模块的 default handler（event 风格）
 */

// 本地开发时加载 .env（Vercel 生产环境会自动注入环境变量）
import 'dotenv/config';

import usersHandler from './users.js';
import tasksHandler from './tasks.js';
import itemsHandler from './items.js';
import coursesHandler from './courses.js';
import documentsHandler from './documents.js';
import llmHandler from './llm.js';
import adminHandler from './admin.js';

// CORS 头部配置
const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
};

// 请求日志记录中间件
function logRequest(event, startTime) {
  const method = event.httpMethod;
  const path = event.path;
  const userAgent = event.headers['user-agent'] || 'Unknown';
  const clientIp = event.headers['x-forwarded-for']?.split(',')[0] || '127.0.0.1';
  const duration = Date.now() - startTime;

  console.log(`[API REQUEST] ${method} ${path} | IP: ${clientIp} | UA: ${userAgent.substring(0, 50)}... | Time: ${duration}ms`);
}

// 路径参数解析辅助函数
function parsePathParams(path, pattern) {
  const regex = new RegExp(pattern);
  const match = path.match(regex);
  if (!match) return null;

  // 目前路由 pattern 均为正则捕获组形式：^/api/xxx/([^/]+)$
  // 这里统一把第一个捕获组映射为 id（各模块内部再按需命名）
  if (match.length <= 1) return null;
  return { id: match[1] };
}

// 统一错误响应构造函数
const createError = (message, statusCode = 400, details = {}) => ({
  statusCode,
  headers: { ...corsHeaders },
  body: JSON.stringify({
    success: false,
    error: message,
    statusCode,
    timestamp: new Date().toISOString(),
    ...details
  })
});

// 统一成功响应构造函数
const createSuccess = (data, statusCode = 200) => ({
  statusCode,
  headers: { ...corsHeaders },
  body: JSON.stringify({
    success: true,
    data,
    statusCode,
    timestamp: new Date().toISOString()
  })
});

// 健康检查端点处理器
async function handleHealthCheck() {
  // 模拟系统状态检查（实际应用中应检测数据库连接等）
  const systemStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development',
    databaseConnected: true, // 实际应通过db.ping()等方式检测
    storageAvailable: true,
    llmServiceReachable: !!process.env.LLM_API_KEY
  };

  return createSuccess(systemStatus);
}

// 请求体解析中间件
async function parseRequestBody(event) {
  try {
    if (!event.body) return {};

    const contentType = event.headers['content-type'] || '';
    
    if (contentType.includes('application/json')) {
      return JSON.parse(event.body);
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      return Object.fromEntries(new URLSearchParams(event.body));
    } else {
      return { rawBody: event.body };
    }
  } catch (err) {
    console.error('请求体解析失败:', err);
    throw new Error('无效的请求数据格式');
  }
}

// 路由分发主处理器
export default async function handler(event, context) {
  const startTime = Date.now();
  
  // 处理预检请求
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders
    };
  }

  try {
    const method = event.httpMethod;
    const path = event.path;

    // 健康检查端点
    if (path === '/api/health') {
      const result = await handleHealthCheck();
      logRequest(event, startTime);
      return result;
    }

    // 解析请求体（注意：下游模块普遍期望 event.body 为 JSON 字符串）
    // 这里只做“可选解析”，并把解析结果放到 event.parsedBody 供需要的模块使用
    let parsedBody = undefined;
    if (['POST', 'PUT', 'PATCH'].includes(method) && event.body) {
      try {
        parsedBody = await parseRequestBody(event);
      } catch {
        // 仍交给下游模块处理（下游会返回更具体的错误）
      }
    }

    const routedEvent = { ...event, parsedBody };

    // 按前缀分发到各模块的 default handler（保持各模块自己的路由逻辑）
    let response;
    if (path.startsWith('/api/users')) {
      response = await usersHandler(routedEvent, context);
    } else if (path.startsWith('/api/tasks')) {
      response = await tasksHandler(routedEvent, context);
    } else if (path.startsWith('/api/items')) {
      response = await itemsHandler(routedEvent, context);
    } else if (path.startsWith('/api/courses')) {
      response = await coursesHandler(routedEvent, context);
    } else if (path.startsWith('/api/documents')) {
      response = await documentsHandler(routedEvent, context);
    } else if (path.startsWith('/api/llm')) {
      response = await llmHandler(routedEvent, context);
    } else if (path.startsWith('/api/admin')) {
      response = await adminHandler(routedEvent, context);
    } else {
      response = createError('接口未找到', 404);
    }

    // 确保响应头包含CORS
    if (response.headers) {
      response.headers = { ...corsHeaders, ...response.headers };
    } else {
      response.headers = { ...corsHeaders };
    }

    logRequest(event, startTime);
    return response;

  } catch (error) {
    console.error(`[API ERROR] ${event.httpMethod} ${event.path}:`, error);
    
    logRequest(event, startTime);
    
    if (error.message === '无效的请求数据格式') {
      return createError('请求数据格式错误，请检查JSON格式', 400);
    }
    
    return createError('服务器内部错误', 500);
  }
}