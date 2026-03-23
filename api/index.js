/**
 * api/index.js - 统双班务网页 Serverless Functions 主入口文件
 * 作为Vercel无服务器函数的统一入口，实现API路由分发、中间件集成和请求处理
 * 部署于 Vercel Serverless Functions (/api)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// 加载环境变量配置
require('dotenv').config();

// 导入各API模块处理器
import * as usersHandler from './users.js';
import * as tasksHandler from './tasks.js';
import * as itemsHandler from './items.js';
import * as coursesHandler from './courses.js';
import * as documentsHandler from './documents.js';
import * as llmHandler from './llm.js';
import * as adminHandler from './admin.js';

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
  
  // 提取命名捕获组或路径参数
  const params = {};
  if (pattern.includes('{id}') || pattern.includes('{task_id}') || pattern.includes('{item_id}')) {
    const keys = pattern.match(/{(\w+)}/g)?.map(k => k.slice(1, -1)) || [];
    keys.forEach((key, index) => {
      params[key] = match[index + 1];
    });
  }
  return Object.keys(params).length > 0 ? params : null;
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

// 路由表定义：根据路径模式匹配对应的处理函数
const ROUTES = [
  // 用户管理路由
  { method: 'GET', pattern: '^/api/users$', handler: usersHandler.getUsers },
  { method: 'POST', pattern: '^/api/users$', handler: usersHandler.createUser },
  { method: 'GET', pattern: '^/api/users/([^/]+)$', handler: usersHandler.getUserById },
  { method: 'PUT', pattern: '^/api/users/([^/]+)$', handler: usersHandler.updateUser },
  { method: 'DELETE', pattern: '^/api/users/([^/]+)$', handler: usersHandler.deleteUser },
  { method: 'POST', pattern: '^/api/users/login$', handler: usersHandler.loginUser },

  // 任务管理路由
  { method: 'GET', pattern: '^/api/tasks$', handler: tasksHandler.getTasks },
  { method: 'POST', pattern: '^/api/tasks$', handler: tasksHandler.createTask },
  { method: 'GET', pattern: '^/api/tasks/([^/]+)$', handler: tasksHandler.getTaskById },
  { method: 'PUT', pattern: '^/api/tasks/([^/]+)$', handler: tasksHandler.updateTask },
  { method: 'DELETE', pattern: '^/api/tasks/([^/]+)$', handler: tasksHandler.deleteTask },
  { method: 'POST', pattern: '^/api/tasks/([^/]+)/submissions$', handler: tasksHandler.submitForm },

  // 物资管理路由
  { method: 'GET', pattern: '^/api/items$', handler: itemsHandler.getItems },
  { method: 'POST', pattern: '^/api/items$', handler: itemsHandler.createItem },
  { method: 'GET', pattern: '^/api/items/([^/]+)$', handler: itemsHandler.getItemById },
  { method: 'POST', pattern: '^/api/items/([^/]+)/borrow$', handler: itemsHandler.borrowItem },
  { method: 'POST', pattern: '^/api/items/([^/]+)/return$', handler: itemsHandler.returnItem },
  { method: 'POST', pattern: '^/api/items/([^/]+)/confirm-return$', handler: itemsHandler.confirmReturn },

  // 课程管理路由
  { method: 'GET', pattern: '^/api/courses$', handler: coursesHandler.getCourses },
  { method: 'POST', pattern: '^/api/courses$', handler: coursesHandler.createCourse },
  { method: 'GET', pattern: '^/api/courses/([^/]+)$', handler: coursesHandler.getCourseById },
  { method: 'POST', pattern: '^/api/courses/([^/]+)/intel$', handler: coursesHandler.publishIntel },
  { method: 'POST', pattern: '^/api/courses/intel/([^/]+)/upvote$', handler: coursesHandler.upvoteIntel },

  // 文档管理路由
  { method: 'GET', pattern: '^/api/documents$', handler: documentsHandler.getDocuments },
  { method: 'POST', pattern: '^/api/documents$', handler: documentsHandler.uploadDocument },
  { method: 'GET', pattern: '^/api/documents/([^/]+)$', handler: documentsHandler.getDocumentById },
  { method: 'GET', pattern: '^/api/documents/([^/]+)/download$', handler: documentsHandler.downloadDocument },
  { method: 'POST', pattern: '^/api/documents/([^/]+)/mark-important$', handler: documentsHandler.markImportant },

  // LLM问答路由
  { method: 'POST', pattern: '^/api/llm/ask$', handler: llmHandler.askQuestion },
  { method: 'POST', pattern: '^/api/llm/conversation$', handler: llmHandler.createConversation },
  { method: 'GET', pattern: '^/api/llm/conversation/([^/]+)$', handler: llmHandler.getConversation },

  // 后台管理路由
  { method: 'GET', pattern: '^/api/admin/dashboard$', handler: adminHandler.getDashboard },
  { method: 'GET', pattern: '^/api/admin/config$', handler: adminHandler.getConfig },
  { method: 'PUT', pattern: '^/api/admin/config$', handler: adminHandler.updateConfig },
  { method: 'GET', pattern: '^/api/admin/audit-logs$', handler: adminHandler.getAuditLogs }
];

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

    // 查找匹配的路由
    const route = ROUTES.find(r => r.method === method && new RegExp(r.pattern).test(path));
    
    if (!route) {
      logRequest(event, startTime);
      return createError('接口未找到', 404);
    }

    // 解析路径参数
    const pathParams = parsePathParams(path, route.pattern);
    
    // 解析请求体
    let requestBody = {};
    if (['POST', 'PUT', 'PATCH'].includes(method) && event.body) {
      requestBody = await parseRequestBody(event);
    }

    // 构造上下文对象传递给处理函数
    const requestContext = {
      ...event,
      pathParameters: pathParams,
      body: requestBody,
      query: event.queryStringParameters || {}
    };

    // 调用对应的处理函数
    const response = await route.handler(requestContext);

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