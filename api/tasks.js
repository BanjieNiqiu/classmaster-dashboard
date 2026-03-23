/**
 * api/tasks.js - 班务收集任务管理 Serverless Function
 * 实现班务信息收集的完整功能，包括任务定义、表单提交、数据导出等
 * 部署于 Vercel Serverless Functions (/api/tasks)
 */

import { v4 as uuidv4 } from 'uuid';
import ExcelJS from 'exceljs';
import { Readable } from 'stream';

// 模拟数据库连接（实际应替换为 MongoDB/Supabase 等）
const db = {
  task_definitions: [],
  task_submissions: []
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

/**
 * 身份验证中间件：验证 JWT 令牌并返回用户信息
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

    return { user };
  } catch (err) {
    console.error('认证失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * 角色权限检查中间件
 * @param {string} userRole - 当前用户角色
 * @param {Array<string>} requiredRoles - 所需角色列表
 * @returns {boolean} 是否有权限
 */
function checkPermission(userRole, requiredRoles) {
  const roleHierarchy = ['guest', 'student', 'monitor', 'admin'];
  const userLevel = roleHierarchy.indexOf(userRole);
  return requiredRoles.some(role => roleHierarchy.indexOf(role) <= userLevel);
}

/**
 * 任务定义验证
 * @param {Object} taskData - 待验证的任务数据
 * @returns {Object} 验证结果
 */
function validateTaskDefinition(taskData) {
  const errors = [];

  if (!taskData.title || taskData.title.trim().length === 0) {
    errors.push('任务标题不能为空');
  }

  if (!taskData.schema || typeof taskData.schema !== 'object' || Object.keys(taskData.schema).length === 0) {
    errors.push('表单schema必须是一个非空对象');
  } else {
    // 验证schema字段
    for (const [key, field] of Object.entries(taskData.schema)) {
      if (!field.type) {
        errors.push(`字段 "${key}" 缺少类型定义`);
        continue;
      }
      const validTypes = ['text', 'number', 'date', 'select', 'multiselect', 'dropdown', 'file'];
      if (!validTypes.includes(field.type)) {
        errors.push(`字段 "${key}" 的类型 "${field.type}" 不被支持`);
      }
      if (field.required !== undefined && typeof field.required !== 'boolean') {
        errors.push(`字段 "${key}" 的required属性必须是布尔值`);
      }
    }
  }

  if (!taskData.deadline) {
    errors.push('截止时间不能为空');
  } else {
    const deadline = new Date(taskData.deadline);
    if (isNaN(deadline.getTime())) {
      errors.push('截止时间格式无效');
    }
  }

  if (taskData.status && !['active', 'closed', 'deleted'].includes(taskData.status)) {
    errors.push('状态必须是 active, closed 或 deleted');
  }

  if (taskData.visibility && !['public', 'class-only'].includes(taskData.visibility)) {
    errors.push('可见性必须是 public 或 class-only');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 表单提交数据验证（基于任务schema）
 * @param {Object} submissionData - 提交的数据
 * @param {Object} schema - 任务定义中的schema
 * @returns {Object} 验证结果
 */
function validateSubmissionData(submissionData, schema) {
  const errors = [];
  const content = submissionData.content || {};

  // 检查必填字段
  for (const [key, field] of Object.entries(schema)) {
    if (field.required && (content[key] === undefined || content[key] === null || content[key].toString().trim() === '')) {
      errors.push(`"${field.label || key}" 是必填项`);
      continue;
    }

    // 类型特定验证
    if (content[key] !== undefined && content[key] !== null) {
      switch (field.type) {
        case 'number':
          if (isNaN(Number(content[key]))) {
            errors.push(`"${field.label || key}" 必须是数字`);
          }
          break;
        case 'date':
          const date = new Date(content[key]);
          if (isNaN(date.getTime())) {
            errors.push(`"${field.label || key}" 必须是有效日期`);
          }
          break;
        case 'select':
        case 'dropdown':
          if (field.options && !field.options.includes(content[key])) {
            errors.push(`"${field.label || key}" 的值不合法`);
          }
          break;
        case 'multiselect':
          if (field.options && Array.isArray(content[key])) {
            const invalidValues = content[key].filter(v => !field.options.includes(v));
            if (invalidValues.length > 0) {
              errors.push(`"${field.label || key}" 包含非法选项: ${invalidValues.join(', ')}`);
            }
          } else {
            errors.push(`"${field.label || key}" 必须是数组`);
          }
          break;
        case 'file':
          // 文件上传由前端处理，后端仅验证URL格式
          if (typeof content[key] !== 'string' || !content[key].startsWith('http')) {
            errors.push(`"${field.label || key}" 必须是有效的文件链接`);
          }
          break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * GET /api/tasks - 获取任务列表，支持按状态、创建者、截止时间筛选
 */
export async function getTasks(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { status, creator, start_date, end_date, visibility } = event.queryStringParameters || {};
    
    let tasks = [...db.task_definitions];

    // 权限过滤：游客只能查看公开任务
    if (authResult.user.role === 'guest') {
      tasks = tasks.filter(t => t.visibility === 'public');
    }

    // 状态筛选
    if (status) {
      tasks = tasks.filter(t => t.status === status);
    }

    // 创建者筛选
    if (creator) {
      tasks = tasks.filter(t => t.creator_id === creator);
    }

    // 时间范围筛选
    if (start_date) {
      const start = new Date(start_date);
      tasks = tasks.filter(t => new Date(t.created_at) >= start);
    }
    if (end_date) {
      const end = new Date(end_date);
      tasks = tasks.filter(t => new Date(t.created_at) <= end);
    }

    // 可见性筛选
    if (visibility) {
      tasks = tasks.filter(t => t.visibility === visibility);
    }

    // 自动更新过期任务状态
    const now = new Date();
    let hasUpdated = false;
    tasks.forEach(task => {
      if (task.status === 'active' && new Date(task.deadline) < now) {
        task.status = 'closed';
        hasUpdated = true;
      }
    });

    if (hasUpdated) {
      // 在实际应用中，这里应该持久化更新到数据库
      console.log('已自动关闭过期任务');
    }

    // 移除敏感信息
    const sanitizedTasks = tasks.map(task => {
      const { password_hash, ...rest } = task;
      return rest;
    });

    return createSuccess({
      data: sanitizedTasks,
      total: sanitizedTasks.length
    });
  } catch (err) {
    console.error('获取任务列表失败:', err);
    return createError('无法获取任务列表', 500);
  }
}

/**
 * POST /api/tasks - 创建新的收集任务
 */
export async function createTask(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  // 只有班委和开发者可以创建任务
  if (!checkPermission(authResult.user.role, ['monitor', 'admin'])) {
    return createError('权限不足，只有班委及以上角色可以创建任务', 403);
  }

  try {
    const body = JSON.parse(event.body || '{}');

    // 验证任务定义
    const validation = validateTaskDefinition(body);
    if (!validation.valid) {
      return createError(`任务定义无效: ${validation.errors.join('; ')}`, 400);
    }

    const newTask = {
      task_id: uuidv4(),
      title: body.title.trim(),
      description: body.description || '',
      schema: body.schema,
      status: body.status || 'active',
      visibility: body.visibility || 'class-only',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deadline: new Date(body.deadline).toISOString(),
      creator_id: authResult.user.user_id
    };

    db.task_definitions.push(newTask);

    // 记录操作日志
    console.log(`[AUDIT] 用户 ${authResult.user.user_id} 创建了新任务: ${newTask.task_id}`);

    return createSuccess(newTask, 201);
  } catch (err) {
    console.error('创建任务失败:', err);
    return createError('创建任务时发生错误', 500);
  }
}

/**
 * GET /api/tasks/{task_id} - 获取单个任务详情
 */
export async function getTaskById(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { task_id } = event.pathParameters || {};
    if (!task_id) {
      return createError('缺少任务ID', 400);
    }

    const task = db.task_definitions.find(t => t.task_id === task_id);
    if (!task) {
      return createError('任务未找到', 404);
    }

    // 权限检查：游客只能查看公开任务
    if (authResult.user.role === 'guest' && task.visibility !== 'public') {
      return createError('无权访问此任务', 403);
    }

    // 返回脱敏数据
    const { password_hash, ...sanitizedTask } = task;
    return createSuccess(sanitizedTask);
  } catch (err) {
    console.error('获取任务详情失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * PUT /api/tasks/{task_id} - 编辑现有任务
 */
export async function updateTask(event) {
  if (event.httpMethod !== 'PUT') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { task_id } = event.pathParameters || {};
    if (!task_id) {
      return createError('缺少任务ID', 400);
    }

    const task = db.task_definitions.find(t => t.task_id === task_id);
    if (!task) {
      return createError('任务未找到', 404);
    }

    // 权限检查：只有创建者或管理员可以编辑
    if (task.creator_id !== authResult.user.user_id && authResult.user.role !== 'admin') {
      return createError('只有任务创建者或管理员可以编辑任务', 403);
    }

    const body = JSON.parse(event.body || '{}');

    // 如果提供了新的schema，进行验证
    if (body.schema) {
      const validation = validateTaskDefinition({ ...task, schema: body.schema });
      if (!validation.valid) {
        return createError(`表单schema无效: ${validation.errors.join('; ')}`, 400);
      }
    }

    // 更新可修改的字段
    if (body.title !== undefined) task.title = body.title.trim();
    if (body.description !== undefined) task.description = body.description;
    if (body.schema !== undefined) task.schema = body.schema;
    if (body.status !== undefined && ['active', 'closed', 'deleted'].includes(body.status)) {
      task.status = body.status;
    }
    if (body.visibility !== undefined && ['public', 'class-only'].includes(body.visibility)) {
      task.visibility = body.visibility;
    }
    if (body.deadline !== undefined) {
      const deadlineDate = new Date(body.deadline);
      if (isNaN(deadlineDate.getTime())) {
        return createError('截止时间格式无效', 400);
      }
      task.deadline = deadlineDate.toISOString();
    }

    task.updated_at = new Date().toISOString();

    // 记录操作日志
    console.log(`[AUDIT] 用户 ${authResult.user.user_id} 更新了任务: ${task_id}`);

    const { password_hash, ...sanitizedTask } = task;
    return createSuccess(sanitizedTask);
  } catch (err) {
    console.error('更新任务失败:', err);
    return createError('更新任务时发生错误', 500);
  }
}

/**
 * DELETE /api/tasks/{task_id} - 删除任务（软删除）
 */
export async function deleteTask(event) {
  if (event.httpMethod !== 'DELETE') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { task_id } = event.pathParameters || {};
    if (!task_id) {
      return createError('缺少任务ID', 400);
    }

    const task = db.task_definitions.find(t => t.task_id === task_id);
    if (!task) {
      return createError('任务未找到', 404);
    }

    // 权限检查：只有创建者或管理员可以删除
    if (task.creator_id !== authResult.user.user_id && authResult.user.role !== 'admin') {
      return createError('只有任务创建者或管理员可以删除任务', 403);
    }

    // 二次确认通过请求头传递
    const confirmHeader = event.headers['x-confirm-delete'] || event.headers['X-Confirm-Delete'];
    if (!confirmHeader || confirmHeader !== 'true') {
      return createError('删除操作需要二次确认，请在请求头中添加 X-Confirm-Delete: true', 400);
    }

    // 软删除：将状态设置为deleted
    task.status = 'deleted';
    task.deleted_at = new Date().toISOString();
    task.updated_at = new Date().toISOString();

    // 在实际应用中，还应删除或标记相关的提交记录
    db.task_submissions
      .filter(s => s.task_id === task_id)
      .forEach(s => {
        s.status = 'deleted';
        s.updated_at = new Date().toISOString();
      });

    // 记录操作日志
    console.log(`[AUDIT] 用户 ${authResult.user.user_id} 删除了任务: ${task_id}`);

    return createSuccess({ message: '任务已成功删除' });
  } catch (err) {
    console.error('删除任务失败:', err);
    return createError('删除任务时发生错误', 500);
  }
}

/**
 * POST /api/tasks/{task_id}/submissions - 提交表单数据
 */
export async function submitTask(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { task_id } = event.pathParameters || {};
    if (!task_id) {
      return createError('缺少任务ID', 400);
    }

    const task = db.task_definitions.find(t => t.task_id === task_id);
    if (!task) {
      return createError('任务未找到', 404);
    }

    // 权限检查：游客不能提交
    if (authResult.user.role === 'guest') {
      return createError('游客无权提交表单', 403);
    }

    // 状态检查
    if (task.status === 'deleted') {
      return createError('该任务已被删除', 404);
    }
    if (task.status === 'closed') {
      return createError('该任务已关闭，无法提交', 400);
    }
    if (new Date(task.deadline) < new Date()) {
      return createError('该任务已过期，无法提交', 400);
    }

    const body = JSON.parse(event.body || '{}');
    const content = body.content;

    if (!content || typeof content !== 'object') {
      return createError('提交内容必须是一个对象', 400);
    }

    // 验证提交数据
    const validation = validateSubmissionData({ content }, task.schema);
    if (!validation.valid) {
      return createError(`表单验证失败: ${validation.errors.join('; ')}`, 400);
    }

    // 检查是否已提交（防止重复提交，可根据需求调整）
    const existingSubmission = db.task_submissions.find(
      s => s.task_id === task_id && s.user_id === authResult.user.user_id && s.status !== 'deleted'
    );
    if (existingSubmission && task.allow_multiple !== true) {
      return createError('您已经提交过此任务，不允许重复提交', 400);
    }

    const newSubmission = {
      submit_id: uuidv4(),
      task_id,
      user_id: authResult.user.user_id,
      content,
      submit_time: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'active'
    };

    db.task_submissions.push(newSubmission);

    // 记录操作日志
    console.log(`[AUDIT] 用户 ${authResult.user.user_id} 提交了任务: ${task_id}`);

    return createSuccess(newSubmission, 201);
  } catch (err) {
    console.error('提交表单失败:', err);
    return createError('提交表单时发生错误', 500);
  }
}

/**
 * GET /api/tasks/{task_id}/submissions - 获取某个任务的所有提交记录
 */
export async function getSubmissions(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { task_id } = event.pathParameters || {};
    if (!task_id) {
      return createError('缺少任务ID', 400);
    }

    const task = db.task_definitions.find(t => t.task_id === task_id);
    if (!task) {
      return createError('任务未找到', 404);
    }

    // 权限检查
    if (task.creator_id !== authResult.user.user_id && authResult.user.role !== 'admin' && authResult.user.role !== 'monitor') {
      // 普通同学只能查看自己的提交
      if (authResult.user.role === 'student') {
        const mySubmissions = db.task_submissions.filter(
          s => s.task_id === task_id && s.user_id === authResult.user.user_id && s.status !== 'deleted'
        ).map(({ password_hash, ...s }) => s);
        return createSuccess({ data: mySubmissions });
      }
      return createError('无权查看此任务的提交记录', 403);
    }

    // 班委、管理员和创建者可以查看所有提交
    const submissions = db.task_submissions
      .filter(s => s.task_id === task_id && s.status !== 'deleted')
      .map(({ password_hash, ...s }) => s);

    return createSuccess({
      data: submissions,
      total: submissions.length
    });
  } catch (err) {
    console.error('获取提交记录失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * GET /api/tasks/submissions/{submit_id} - 获取单个提交详情
 */
export async function getSubmissionById(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { submit_id } = event.pathParameters || {};
    if (!submit_id) {
      return createError('缺少提交ID', 400);
    }

    const submission = db.task_submissions.find(s => s.submit_id === submit_id);
    if (!submission || submission.status === 'deleted') {
      return createError('提交记录未找到', 404);
    }

    const task = db.task_definitions.find(t => t.task_id === submission.task_id);
    if (!task) {
      return createError('关联任务未找到', 404);
    }

    // 权限检查
    if (submission.user_id !== authResult.user.user_id && 
        task.creator_id !== authResult.user.user_id && 
        authResult.user.role !== 'admin' && 
        authResult.user.role !== 'monitor') {
      return createError('无权查看此提交记录', 403);
    }

    const { password_hash, ...sanitizedSubmission } = submission;
    return createSuccess(sanitizedSubmission);
  } catch (err) {
    console.error('获取提交详情失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * PUT /api/tasks/submissions/{submit_id} - 修改已提交的表单数据
 */
export async function updateSubmission(event) {
  if (event.httpMethod !== 'PUT') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { submit_id } = event.pathParameters || {};
    if (!submit_id) {
      return createError('缺少提交ID', 400);
    }

    const submission = db.task_submissions.find(s => s.submit_id === submit_id);
    if (!submission || submission.status === 'deleted') {
      return createError('提交记录未找到', 404);
    }

    const task = db.task_definitions.find(t => t.task_id === submission.task_id);
    if (!task) {
      return createError('关联任务未找到', 404);
    }

    // 权限检查：只有提交者本人、任务创建者或管理员可以修改
    if (submission.user_id !== authResult.user.user_id && 
        task.creator_id !== authResult.user.user_id && 
        authResult.user.role !== 'admin') {
      return createError('只有提交者本人、任务创建者或管理员可以修改提交', 403);
    }

    // 状态检查：已关闭的任务不能修改
    if (task.status === 'closed' || task.status === 'deleted') {
      return createError('该任务已关闭或删除，无法修改提交', 400);
    }

    const body = JSON.parse(event.body || '{}');
    const content = body.content;

    if (!content || typeof content !== 'object') {
      return createError('提交内容必须是一个对象', 400);
    }

    // 验证新数据
    const validation = validateSubmissionData({ content }, task.schema);
    if (!validation.valid) {
      return createError(`表单验证失败: ${validation.errors.join('; ')}`, 400);
    }

    // 更新提交
    submission.content = content;
    submission.updated_at = new Date().toISOString();

    // 记录操作日志
    console.log(`[AUDIT] 用户 ${authResult.user.user_id} 修改了提交: ${submit_id}`);

    const { password_hash, ...sanitizedSubmission } = submission;
    return createSuccess(sanitizedSubmission);
  } catch (err) {
    console.error('修改提交失败:', err);
    return createError('修改提交时发生错误', 500);
  }
}

/**
 * DELETE /api/tasks/submissions/{submit_id} - 删除提交记录
 */
export async function deleteSubmission(event) {
  if (event.httpMethod !== 'DELETE') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { submit_id } = event.pathParameters || {};
    if (!submit_id) {
      return createError('缺少提交ID', 400);
    }

    const submission = db.task_submissions.find(s => s.submit_id === submit_id);
    if (!submission || submission.status === 'deleted') {
      return createError('提交记录未找到', 404);
    }

    const task = db.task_definitions.find(t => t.task_id === submission.task_id);
    if (!task) {
      return createError('关联任务未找到', 404);
    }

    // 权限检查：只有提交者本人、任务创建者或管理员可以删除
    if (submission.user_id !== authResult.user.user_id && 
        task.creator_id !== authResult.user.user_id && 
        authResult.user.role !== 'admin') {
      return createError('只有提交者本人、任务创建者或管理员可以删除提交', 403);
    }

    // 二次确认
    const confirmHeader = event.headers['x-confirm-delete'] || event.headers['X-Confirm-Delete'];
    if (!confirmHeader || confirmHeader !== 'true') {
      return createError('删除操作需要二次确认，请在请求头中添加 X-Confirm-Delete: true', 400);
    }

    // 软删除
    submission.status = 'deleted';
    submission.deleted_at = new Date().toISOString();
    submission.updated_at = new Date().toISOString();

    // 记录操作日志
    console.log(`[AUDIT] 用户 ${authResult.user.user_id} 删除了提交: ${submit_id}`);

    return createSuccess({ message: '提交记录已成功删除' });
  } catch (err) {
    console.error('删除提交失败:', err);
    return createError('删除提交时发生错误', 500);
  }
}

/**
 * GET /api/tasks/{task_id}/export - 将收集结果导出为Excel格式
 */
export async function exportTaskData(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { task_id } = event.pathParameters || {};
    if (!task_id) {
      return createError('缺少任务ID', 400);
    }

    const task = db.task_definitions.find(t => t.task_id === task_id);
    if (!task) {
      return createError('任务未找到', 404);
    }

    // 权限检查：只有任务创建者、班委或管理员可以导出
    if (task.creator_id !== authResult.user.user_id && 
        !['admin', 'monitor'].includes(authResult.user.role)) {
      return createError('只有任务创建者、班委或管理员可以导出数据', 403);
    }

    if (task.status === 'deleted') {
      return createError('该任务已被删除', 404);
    }

    // 创建Excel工作簿
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('收集数据');

    // 添加标题行
    const headerRow = ['提交编号', '学号', '提交时间', '最后更新'];
    Object.keys(task.schema).forEach(key => {
      const field = task.schema[key];
      headerRow.push(field.label || key);
    });
    worksheet.addRow(headerRow);

    // 设置列宽
    worksheet.columns = [
      { key: 'submit_id', width: 20 },
      { key: 'user_id', width: 15 },
      { key: 'submit_time', width: 20 },
      { key: 'updated_at', width: 20 }
    ];
    Object.keys(task.schema).forEach(() => {
      worksheet.columns.push({ width: 20 });
    });

    // 添加数据行
    const submissions = db.task_submissions
      .filter(s => s.task_id === task_id && s.status === 'active')
      .sort((a, b) => new Date(a.submit_time) - new Date(b.submit_time));

    submissions.forEach(submission => {
      const row = [
        submission.submit_id,
        submission.user_id,
        new Date(submission.submit_time).toLocaleString(),
        new Date(submission.updated_at).toLocaleString()
      ];

      Object.keys(task.schema).forEach(key => {
        const value = submission.content[key];
        // 格式化不同类型的数据
        if (value instanceof Date) {
          row.push(value.toLocaleString());
        } else if (Array.isArray(value)) {
          row.push(value.join(', '));
        } else {
          row.push(value);
        }
      });

      worksheet.addRow(row);
    });

    // 生成Excel文件
    const buffer = await workbook.xlsx.writeBuffer();

    // 在实际应用中，应将文件存储在临时路径并返回下载链接
    // 此处直接返回文件内容（Vercel Serverless Function 支持二进制响应）
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(task.title)}_导出_${new Date().toISOString().split('T')[0]}.xlsx"`,
        'Cache-Control': 'no-cache'
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true
    };
  } catch (err) {
    console.error('导出数据失败:', err);
    return createError('导出数据时发生错误', 500);
  }
}

/**
 * GET /api/tasks/stats/fill-progress/{task_id} - 填写进度统计接口
 */
export async function getFillProgress(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { task_id } = event.pathParameters || {};
    if (!task_id) {
      return createError('缺少任务ID', 400);
    }

    const task = db.task_definitions.find(t => t.task_id === task_id);
    if (!task) {
      return createError('任务未找到', 404);
    }

    // 权限检查：班委及以上角色可以查看统计
    if (task.creator_id !== authResult.user.user_id && 
        !['admin', 'monitor'].includes(authResult.user.role)) {
      return createError('无权查看此任务的统计信息', 403);
    }

    const totalStudents = db.users?.filter(u => u.role === 'student').length || 0;
    const submittedCount = db.task_submissions.filter(
      s => s.task_id === task_id && s.status === 'active'
    ).length;

    const progress = totalStudents > 0 ? Math.round((submittedCount / totalStudents) * 100) : 0;

    return createSuccess({
      task_id,
      title: task.title,
      total_students: totalStudents,
      submitted_count: submittedCount,
      not_submitted_count: totalStudents - submittedCount,
      fill_progress: progress,
      deadline: task.deadline,
      status: task.status
    });
  } catch (err) {
    console.error('获取填写进度失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * GET /api/tasks/stats/trend/{task_id} - 提交趋势分析接口
 */
export async function getSubmissionTrend(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { task_id } = event.pathParameters || {};
    if (!task_id) {
      return createError('缺少任务ID', 400);
    }

    const task = db.task_definitions.find(t => t.task_id === task_id);
    if (!task) {
      return createError('任务未找到', 404);
    }

    // 权限检查
    if (task.creator_id !== authResult.user.user_id && 
        !['admin', 'monitor'].includes(authResult.user.role)) {
      return createError('无权查看此任务的统计信息', 403);
    }

    const submissions = db.task_submissions
      .filter(s => s.task_id === task_id && s.status === 'active')
      .sort((a, b) => new Date(a.submit_time) - new Date(b.submit_time));

    // 按天分组统计
    const trendMap = new Map();
    submissions.forEach(sub => {
      const date = new Date(sub.submit_time).toDateString();
      trendMap.set(date, (trendMap.get(date) || 0) + 1);
    });

    // 转换为数组
    const trendData = Array.from(trendMap.entries()).map(([date, count]) => ({
      date,
      count,
      cumulative: 0 // 后面计算累计值
    })).sort((a, b) => new Date(a.date) - new Date(b.date));

    // 计算累计值
    let cumulative = 0;
    trendData.forEach(item => {
      cumulative += item.count;
      item.cumulative = cumulative;
    });

    return createSuccess({
      task_id,
      title: task.title,
      trend_data: trendData,
      total_submissions: trendData.length > 0 ? trendData[trendData.length - 1].cumulative : 0
    });
  } catch (err) {
    console.error('获取提交趋势失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * GET /api/tasks/stats/field-data/{task_id}/{field_key} - 字段数据统计接口（针对数值型字段）
 */
export async function getFieldStats(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { task_id, field_key } = event.pathParameters || {};
    if (!task_id || !field_key) {
      return createError('缺少任务ID或字段键名', 400);
    }

    const task = db.task_definitions.find(t => t.task_id === task_id);
    if (!task) {
      return createError('任务未找到', 404);
    }

    const field = task.schema[field_key];
    if (!field) {
      return createError('字段未找到', 404);
    }

    // 权限检查
    if (task.creator_id !== authResult.user.user_id && 
        !['admin', 'monitor'].includes(authResult.user.role)) {
      return createError('无权查看此字段的统计信息', 403);
    }

    // 目前只支持数值型字段的统计
    if (field.type !== 'number') {
      return createError('此接口仅支持数值型字段的统计', 400);
    }

    const values = db.task_submissions
      .filter(s => s.task_id === task_id && s.status === 'active' && s.content[field_key] !== undefined)
      .map(s => Number(s.content[field_key]))
      .filter(v => !isNaN(v));

    if (values.length === 0) {
      return createSuccess({
        task_id,
        field_key,
        field_label: field.label || field_key,
        count: 0,
        sum: 0,
        avg: 0,
        min: null,
        max: null
      });
    }

    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);

    return createSuccess({
      task_id,
      field_key,
      field_label: field.label || field_key,
      count: values.length,
      sum,
      avg: parseFloat(avg.toFixed(2)),
      min,
      max
    });
  } catch (err) {
    console.error('获取字段统计失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * 主处理器函数 - 根据路由分发请求
 */
export default async function handler(event, context) {
  try {
    // 处理预检请求
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: corsHeaders
      };
    }

    const { path } = event;

    // 路由映射
    const routes = [
      { method: 'GET', pattern: /^\/api\/tasks$/, handler: getTasks },
      { method: 'POST', pattern: /^\/api\/tasks$/, handler: createTask },
      { method: 'GET', pattern: /^\/api\/tasks\/([^\/]+)$/, handler: getTaskById },
      { method: 'PUT', pattern: /^\/api\/tasks\/([^\/]+)$/, handler: updateTask },
      { method: 'DELETE', pattern: /^\/api\/tasks\/([^\/]+)$/, handler: deleteTask },
      { method: 'POST', pattern: /^\/api\/tasks\/([^\/]+)\/submissions$/, handler: submitTask },
      { method: 'GET', pattern: /^\/api\/tasks\/([^\/]+)\/submissions$/, handler: getSubmissions },
      { method: 'GET', pattern: /^\/api\/tasks\/submissions\/([^\/]+)$/, handler: getSubmissionById },
      { method: 'PUT', pattern: /^\/api\/tasks\/submissions\/([^\/]+)$/, handler: updateSubmission },
      { method: 'DELETE', pattern: /^\/api\/tasks\/submissions\/([^\/]+)$/, handler: deleteSubmission },
      { method: 'GET', pattern: /^\/api\/tasks\/([^\/]+)\/export$/, handler: exportTaskData },
      { method: 'GET', pattern: /^\/api\/tasks\/stats\/fill\-progress\/([^\/]+)$/, handler: getFillProgress },
      { method: 'GET', pattern: /^\/api\/tasks\/stats\/trend\/([^\/]+)$/, handler: getSubmissionTrend },
      { method: 'GET', pattern: /^\/api\/tasks\/stats\/field\-data\/([^\/]+)\/([^\/]+)$/, handler: getFieldStats }
    ];

    for (const route of routes) {
      if (event.httpMethod === route.method) {
        const match = path.match(route.pattern);
        if (match) {
          // 将匹配的参数添加到 event.pathParameters
          const paramNames = route.pattern.source.match(/\(\?<(.*?)>/g)?.map(n => n.slice(3, -1)) || [];
          const pathParameters = {};
          match.slice(1).forEach((value, index) => {
            const paramName = paramNames[index] || (index === 0 ? 'id' : `param${index}`);
            pathParameters[paramName] = decodeURIComponent(value);
          });
          event.pathParameters = pathParameters;
          
          return await route.handler(event, context);
        }
      }
    }

    // 未找到路由
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'API 路径未找到' })
    };
  } catch (err) {
    console.error('请求处理失败:', err);
    return createError('服务器内部错误', 500);
  }
}