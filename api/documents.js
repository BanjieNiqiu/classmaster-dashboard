/**
 * api/documents.js - 班务网页文档资源共享 Serverless Function
 * 实现完整的文档上传、下载、管理、版本控制及权限系统
 * 部署于 Vercel Serverless Functions (/api/documents)
 */

import { v4 as uuidv4 } from 'uuid';
import { Readable } from 'stream';

// 模拟数据库连接（实际应替换为 MongoDB/Supabase 等）
const db = {
  documents: [],
  download_records: []
};

// 环境配置
const CONFIG = {
  // 文件上传大小限制 (MB)
  MAX_UPLOAD_SIZE: parseInt(process.env.MAX_UPLOAD_SIZE || '10'),
  // 支持的文件类型
  ALLOWED_MIME_TYPES: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif'
  ],
  // 支持的文件扩展名映射
  MIME_TYPE_MAP: {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif'
  },
  // 文档分类枚举
  CATEGORIES: ['课件', '笔记', '真题', '工具'],
  // OSS 存储基础路径
  OSS_BASE_PATH: process.env.STORAGE_OSS_URL || 'https://example-oss.com/files'
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
 * 角色权限检查辅助函数
 * @param {string} userRole - 当前用户角色
 * @param {Array<string>} requiredRoles - 所需角色列表
 * @returns {boolean} 是否有权限
 */
function hasPermission(userRole, requiredRoles) {
  const roleHierarchy = ['guest', 'student', 'monitor', 'admin'];
  const userLevel = roleHierarchy.indexOf(userRole);
  return requiredRoles.some(role => roleHierarchy.indexOf(role) <= userLevel);
}

/**
 * 检查当前用户是否有权操作该文档
 * @param {Object} document - 文档对象
 * @param {Object} userInfo - 用户信息
 * @param {string} action - 操作类型 ('view', 'edit', 'delete')
 * @returns {Object} 权限校验结果
 */
function checkDocumentPermission(document, userInfo, action) {
  const { user } = userInfo;
  
  // 游客只能查看公开文档
  if (user.role === 'guest') {
    return { ok: false, message: '游客无权进行此操作' };
  }

  switch (action) {
    case 'view':
      // 所有登录用户均可查看
      return { ok: true };

    case 'edit':
      // 上传者可编辑，班委及以上可管理
      if (document.uploader_id === user.user_id || ['monitor', 'admin'].includes(user.role)) {
        return { ok: true };
      }
      return { ok: false, message: '无权编辑此文档' };

    case 'delete':
      // 上传者可删除自己的文档，班委及以上可清理
      if (document.uploader_id === user.user_id || ['monitor', 'admin'].includes(user.role)) {
        return { ok: true };
      }
      return { ok: false, message: '无权删除此文档' };

    default:
      return { ok: false, message: '无效的操作类型' };
  }
}

/**
 * 文件名安全性检查和清理
 * @param {string} filename - 原始文件名
 * @returns {string} 安全的文件名
 */
function sanitizeFilename(filename) {
  // 移除路径遍历字符
  let safeName = filename.replace(/[/\\]/g, '_');
  // 移除特殊字符，保留字母、数字、点、下划线、连字符
  safeName = safeName.replace(/[^a-zA-Z0-9._\-]/g, '_');
  // 防止空文件名
  if (!safeName || safeName === '.' || safeName === '..') {
    safeName = `unnamed_${Date.now()}.file`;
  }
  return safeName;
}

/**
 * 解析文件扩展名并获取MIME类型
 * @param {string} filename - 文件名
 * @returns {Object} 包含扩展名和MIME类型的对象
 */
function getFileInfo(filename) {
  const ext = '.' + filename.split('.').pop().toLowerCase();
  const mimeType = CONFIG.MIME_TYPE_MAP[ext] || 'application/octet-stream';
  return { ext, mimeType };
}

/**
 * 验证文件类型和大小
 * @param {Object} fileMeta - 文件元数据 {size, type}
 * @returns {Object} 验证结果
 */
function validateFile(fileMeta) {
  const errors = [];

  // 检查文件大小 (转换为 MB)
  const fileSizeInMB = fileMeta.size / (1024 * 1024);
  if (fileSizeInMB > CONFIG.MAX_UPLOAD_SIZE) {
    errors.push(`文件大小超过限制 (${CONFIG.MAX_UPLOAD_SIZE}MB)`); 
  }

  // 检查文件类型
  if (!CONFIG.ALLOWED_MIME_TYPES.includes(fileMeta.type)) {
    errors.push(`不支持的文件类型: ${fileMeta.type}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 检测同名文件（同一课程下）
 * @param {string} title - 文档标题
 * @param {string} courseId - 课程ID
 * @param {string} uploaderId - 上传者ID
 * @param {string} docId - 排除的文档ID（编辑时使用）
 * @returns {Array} 同名文件列表
 */
function findDuplicateFiles(title, courseId, uploaderId, docId = null) {
  return db.documents.filter(doc => {
    // 排除自身（编辑时）
    if (doc.doc_id === docId) return false;
    // 检查课程和标题匹配
    return doc.course_id === courseId && doc.title === title;
  });
}

/**
 * 生成唯一的存储路径
 * @param {string} originalName - 原始文件名
 * @returns {string} 存储路径
 */
function generateStoragePath(originalName) {
  const ext = '.' + originalName.split('.').pop().toLowerCase();
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `/documents/${timestamp}_${random}${ext}`;
}

/**
 * 记录操作日志（模拟）
 * @param {string} operatorId - 操作者ID
 * @param {string} action - 操作类型
 * @param {string} target - 目标对象
 * @param {Object} details - 详细信息
 */
function logAction(operatorId, action, target, details = {}) {
  console.log('[ACTION LOG]', {
    timestamp: new Date().toISOString(),
    operator_id: operatorId,
    action,
    target,
    details
  });
}

// --- 文档管理接口 ---

/**
 * GET /api/documents - 获取文档列表，支持筛选和排序
 */
export async function getDocuments(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { 
      course_id, 
      category, 
      uploader_id, 
      sort_by = 'upload_time', 
      sort_order = 'desc',
      search 
    } = event.queryStringParameters || {};

    let filteredDocs = [...db.documents].filter(doc => doc.status !== 'deleted');

    // 筛选条件
    if (course_id) {
      filteredDocs = filteredDocs.filter(doc => doc.course_id === course_id);
    }

    if (category) {
      if (!CONFIG.CATEGORIES.includes(category)) {
        return createError('无效的文档分类');
      }
      filteredDocs = filteredDocs.filter(doc => doc.category === category);
    }

    if (uploader_id) {
      filteredDocs = filteredDocs.filter(doc => doc.uploader_id === uploader_id);
    }

    if (search) {
      const lowerSearch = search.toLowerCase();
      filteredDocs = filteredDocs.filter(doc => 
        doc.title.toLowerCase().includes(lowerSearch) ||
        doc.description?.toLowerCase().includes(lowerSearch)
      );
    }

    // 排序
    filteredDocs.sort((a, b) => {
      let aValue = a[sort_by];
      let bValue = b[sort_by];

      // 特殊处理时间字段
      if (sort_by === 'upload_time') {
        aValue = new Date(aValue);
        bValue = new Date(bValue);
      }

      if (sort_order === 'desc') {
        return bValue > aValue ? 1 : -1;
      } else {
        return aValue > bValue ? 1 : -1;
      }
    });

    return createSuccess({
      data: filteredDocs,
      total: filteredDocs.length,
      filters: { course_id, category, uploader_id, search }
    });
  } catch (err) {
    console.error('获取文档列表失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * GET /api/documents/{doc_id} - 获取单个文档详情
 */
export async function getDocumentById(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { doc_id } = event.pathParameters || {};
    if (!doc_id) {
      return createError('缺少文档ID', 400);
    }

    const document = db.documents.find(doc => doc.doc_id === doc_id && doc.status !== 'deleted');
    if (!document) {
      return createError('文档未找到', 404);
    }

    // 检查查看权限
    const permission = checkDocumentPermission(document, authResult, 'view');
    if (!permission.ok) {
      return createError(permission.message, 403);
    }

    return createSuccess(document);
  } catch (err) {
    console.error('获取文档详情失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * POST /api/documents - 上传新文档
 */
export async function uploadDocument(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  const { user } = authResult;

  // 游客不能上传
  if (user.role === 'guest') {
    return createError('游客无权上传文档', 403);
  }

  try {
    // 模拟从 multipart/form-data 解析数据
    // 实际实现需要使用 busboy 或 multiparty 等库
    const body = JSON.parse(event.body);
    const {
      title,
      course_id,
      category,
      version = 'v1.0',
      description = '',
      original_name,
      file_size,
      file_type
    } = body;

    // 参数验证
    if (!title || !course_id || !category) {
      return createError('缺少必要参数: 标题、课程、分类');
    }

    if (!CONFIG.CATEGORIES.includes(category)) {
      return createError('无效的文档分类');
    }

    // 文件信息验证
    const fileValidation = validateFile({ size: file_size, type: file_type });
    if (!fileValidation.valid) {
      return createError(`文件验证失败: ${fileValidation.errors.join(', ')}`, 400);
    }

    // 检测同名文件
    const duplicates = findDuplicateFiles(title, course_id, user.user_id);
    if (duplicates.length > 0) {
      return createSuccess({
        warning: '检测到同名文件',
        duplicates: duplicates.map(d => ({
          doc_id: d.doc_id,
          title: d.title,
          uploader_id: d.uploader_id,
          upload_time: d.upload_time,
          version: d.file_info.version
        })),
        requires_confirmation: true
      }, 207); // HTTP 207 Multi-Status
    }

    // 清理文件名
    const safeName = sanitizeFilename(original_name || `${title}${getFileInfo(original_name).ext}`);

    // 生成文档ID和存储路径
    const docId = uuidv4();
    const storagePath = generateStoragePath(safeName);

    // 创建文档对象
    const newDocument = {
      doc_id: docId,
      title,
      course_id,
      category,
      description,
      uploader_id: user.user_id,
      upload_time: new Date().toISOString(),
      file_info: {
        original_name: safeName,
        storage_path: `${CONFIG.OSS_BASE_PATH}${storagePath}`,
        size: file_size,
        version: version
      },
      download_count: 0,
      is_important: false,
      status: 'active'
    };

    // 添加到数据库
    db.documents.push(newDocument);

    // 记录操作日志
    logAction(user.user_id, 'DOCUMENT_UPLOAD', docId, {
      title,
      course_id,
      category,
      size: file_size
    });

    return createSuccess({
      message: '文档上传成功',
      doc_id: docId,
      file_url: newDocument.file_info.storage_path
    }, 201);
  } catch (err) {
    console.error('文档上传失败:', err);
    return createError('文档上传失败', 500);
  }
}

/**
 * PUT /api/documents/{doc_id} - 更新文档信息
 */
export async function updateDocument(event) {
  if (event.httpMethod !== 'PUT') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  const { user } = authResult;

  try {
    const { doc_id } = event.pathParameters || {};
    if (!doc_id) {
      return createError('缺少文档ID', 400);
    }

    const document = db.documents.find(doc => doc.doc_id === doc_id && doc.status !== 'deleted');
    if (!document) {
      return createError('文档未找到', 404);
    }

    // 检查编辑权限
    const permission = checkDocumentPermission(document, authResult, 'edit');
    if (!permission.ok) {
      return createError(permission.message, 403);
    }

    const body = JSON.parse(event.body);
    const updates = {};

    // 可更新字段
    if (body.title !== undefined) {
      // 如果标题变更，检查同名文件
      if (body.title !== document.title) {
        const duplicates = findDuplicateFiles(body.title, document.course_id, user.user_id, doc_id);
        if (duplicates.length > 0) {
          return createError('同一课程下已存在同名文件，请修改标题或确认为同一版本');
        }
      }
      updates.title = body.title;
    }

    if (body.course_id !== undefined) updates.course_id = body.course_id;
    if (body.category !== undefined) {
      if (!CONFIG.CATEGORIES.includes(body.category)) {
        return createError('无效的文档分类');
      }
      updates.category = body.category;
    }
    if (body.version !== undefined) updates.file_info.version = body.version;
    if (body.description !== undefined) updates.description = body.description;

    // 应用更新
    Object.assign(document, updates);

    // 记录操作日志
    logAction(user.user_id, 'DOCUMENT_UPDATE', doc_id, { updates });

    return createSuccess({
      message: '文档更新成功',
      doc_id: doc_id,
      updated_fields: Object.keys(updates)
    });
  } catch (err) {
    console.error('更新文档失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * DELETE /api/documents/{doc_id} - 删除文档
 */
export async function deleteDocument(event) {
  if (event.httpMethod !== 'DELETE') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  const { user } = authResult;

  try {
    const { doc_id } = event.pathParameters || {};
    if (!doc_id) {
      return createError('缺少文档ID', 400);
    }

    const document = db.documents.find(doc => doc.doc_id === doc_id && doc.status !== 'deleted');
    if (!document) {
      return createError('文档未找到', 404);
    }

    // 检查删除权限
    const permission = checkDocumentPermission(document, authResult, 'delete');
    if (!permission.ok) {
      return createError(permission.message, 403);
    }

    // 标记为已删除（软删除）
    document.status = 'deleted';
    document.deleted_at = new Date().toISOString();
    document.deleted_by = user.user_id;

    // 记录操作日志
    logAction(user.user_id, 'DOCUMENT_DELETE', doc_id, {
      title: document.title,
      course_id: document.course_id
    });

    return createSuccess({
      message: '文档删除成功',
      doc_id: doc_id
    });
  } catch (err) {
    console.error('删除文档失败:', err);
    return createError('内部服务器错误', 500);
  }
}

// --- 文件下载功能 ---

/**
 * GET /api/documents/{doc_id}/download - 触发文件下载
 */
export async function downloadDocument(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  const { user } = authResult;

  try {
    const { doc_id } = event.pathParameters || {};
    if (!doc_id) {
      return createError('缺少文档ID', 400);
    }

    const document = db.documents.find(doc => doc.doc_id === doc_id && doc.status !== 'deleted');
    if (!document) {
      return createError('文档未找到', 404);
    }

    // 检查查看权限（隐式包含下载权限）
    const permission = checkDocumentPermission(document, authResult, 'view');
    if (!permission.ok) {
      return createError(permission.message, 403);
    }

    // 更新下载计数
    document.download_count += 1;

    // 记录下载历史
    const downloadRecord = {
      record_id: uuidv4(),
      doc_id,
      user_id: user.user_id,
      download_time: new Date().toISOString(),
      ip_address: event.headers['x-forwarded-for'] || 'unknown'
    };
    db.download_records.push(downloadRecord);

    // 记录操作日志
    logAction(user.user_id, 'DOCUMENT_DOWNLOAD', doc_id, {
      title: document.title,
      count: document.download_count
    });

    // 返回重定向到OSS直链（模拟）
    return {
      statusCode: 302,
      headers: {
        ...corsHeaders,
        'Location': document.file_info.storage_path,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    };
  } catch (err) {
    console.error('下载文档失败:', err);
    return createError('内部服务器错误', 500);
  }
}

// --- 重要资料标记功能 ---

/**
 * POST /api/documents/{doc_id}/mark-important - 班委标记重要资料
 */
export async function markImportant(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  const { user } = authResult;

  // 只有班委及以上可标记重要资料
  if (!['monitor', 'admin'].includes(user.role)) {
    return createError('只有班委或管理员可以标记重要资料', 403);
  }

  try {
    const { doc_id } = event.pathParameters || {};
    if (!doc_id) {
      return createError('缺少文档ID', 400);
    }

    const document = db.documents.find(doc => doc.doc_id === doc_id && doc.status !== 'deleted');
    if (!document) {
      return createError('文档未找到', 404);
    }

    // 获取标记状态，默认为true
    const body = JSON.parse(event.body || '{}');
    const important = body.important !== false; // 默认标记为重要

    document.is_important = important;

    // 记录操作日志
    logAction(user.user_id, 'DOCUMENT_MARK_IMPORTANT', doc_id, {
      is_important: important
    });

    return createSuccess({
      message: `文档已${important ? '标记为' : '取消标记为'}重要资料`,
      doc_id: doc_id,
      is_important: important
    });
  } catch (err) {
    console.error('标记重要资料失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * GET /api/documents/important - 获取所有重要资料列表
 */
export async function getImportantDocuments(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const importantDocs = db.documents
      .filter(doc => doc.is_important && doc.status !== 'deleted')
      .sort((a, b) => new Date(b.upload_time) - new Date(a.upload_time));

    return createSuccess({
      data: importantDocs,
      total: importantDocs.length
    });
  } catch (err) {
    console.error('获取重要资料列表失败:', err);
    return createError('内部服务器错误', 500);
  }
}

// --- 数据统计与分析 ---

/**
 * GET /api/documents/stats - 文档数量统计
 */
export async function getDocumentStats(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { course_id, category, start_date, end_date } = event.queryStringParameters || {};

    let filteredDocs = [...db.documents].filter(doc => doc.status !== 'deleted');

    // 时间范围筛选
    if (start_date || end_date) {
      const startDate = start_date ? new Date(start_date) : new Date(0);
      const endDate = end_date ? new Date(end_date) : new Date();
      
      filteredDocs = filteredDocs.filter(doc => {
        const uploadTime = new Date(doc.upload_time);
        return uploadTime >= startDate && uploadTime <= endDate;
      });
    }

    // 统计数据
    const stats = {
      total_documents: filteredDocs.length,
      by_course: {},
      by_category: {},
      time_range: {
        start: start_date || null,
        end: end_date || null
      }
    };

    // 按课程统计
    filteredDocs.forEach(doc => {
      stats.by_course[doc.course_id] = (stats.by_course[doc.course_id] || 0) + 1;
    });

    // 按分类统计
    CONFIG.CATEGORIES.forEach(cat => {
      stats.by_category[cat] = filteredDocs.filter(doc => doc.category === cat).length;
    });

    return createSuccess(stats);
  } catch (err) {
    console.error('获取文档统计失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * GET /api/documents/trends - 上传趋势分析
 */
export async function getUploadTrends(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { period = '7d', course_id, category } = event.queryStringParameters || {};

    // 支持的时间周期
    const periods = {
      '1d': 1,
      '3d': 3,
      '7d': 7,
      '14d': 14,
      '30d': 30,
      '90d': 90
    };

    const days = periods[period] || 7;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    let filteredDocs = [...db.documents]
      .filter(doc => doc.status !== 'deleted')
      .filter(doc => new Date(doc.upload_time) >= cutoffDate);

    // 筛选条件
    if (course_id) {
      filteredDocs = filteredDocs.filter(doc => doc.course_id === course_id);
    }

    if (category) {
      filteredDocs = filteredDocs.filter(doc => doc.category === category);
    }

    // 按天分组统计
    const trends = {};
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - (days - i - 1));
      const dateStr = date.toISOString().split('T')[0];
      trends[dateStr] = 0;
    }

    filteredDocs.forEach(doc => {
      const dateStr = doc.upload_time.split('T')[0];
      if (trends[dateStr] !== undefined) {
        trends[dateStr]++;
      }
    });

    return createSuccess({
      period,
      data: Object.entries(trends).map(([date, count]) => ({ date, count }))
    });
  } catch (err) {
    console.error('获取上传趋势失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * GET /api/documents/top-downloaded - 热门文档排行
 */
export async function getTopDownloaded(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { limit = 10, course_id, category } = event.queryStringParameters || {};

    let filteredDocs = [...db.documents]
      .filter(doc => doc.status !== 'deleted')
      .sort((a, b) => b.download_count - a.download_count)
      .slice(0, parseInt(limit));

    // 筛选条件
    if (course_id) {
      filteredDocs = filteredDocs.filter(doc => doc.course_id === course_id);
    }

    if (category) {
      filteredDocs = filteredDocs.filter(doc => doc.category === category);
    }

    return createSuccess({
      data: filteredDocs.map(doc => ({
        doc_id: doc.doc_id,
        title: doc.title,
        course_id: doc.course_id,
        category: doc.category,
        download_count: doc.download_count,
        upload_time: doc.upload_time,
        is_important: doc.is_important
      })),
      total_returned: filteredDocs.length,
      requested_limit: parseInt(limit)
    });
  } catch (err) {
    console.error('获取热门文档失败:', err);
    return createError('内部服务器错误', 500);
  }
}

// --- 清理与管理功能 ---

/**
 * POST /api/documents/cleanup - 班委清理失效链接或过时资料
 */
export async function cleanupDocuments(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  const { user } = authResult;

  // 只有班委及以上可执行清理
  if (!['monitor', 'admin'].includes(user.role)) {
    return createError('只有班委或管理员可以执行清理操作', 403);
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { 
      // 自动归档超过指定天数未更新的文档
      archive_days = 365,
      // 删除已标记为删除且超过指定天数的文档
      purge_deleted_days = 30,
      // 只清理特定课程或分类
      course_id,
      category,
      // 干运行模式，只返回将要清理的项目
      dry_run = false
    } = body;

    const now = new Date();
    const results = {
      archived_count: 0,
      purged_count: 0,
      archived_list: [],
      purged_list: [],
      dry_run
    };

    // 归档长时间未更新的文档
    const archiveCutoff = new Date();
    archiveCutoff.setDate(now.getDate() - archive_days);

    db.documents.forEach(doc => {
      if (doc.status === 'archived') return; // 已归档的跳过
      
      const lastUpdated = new Date(doc.upload_time);
      const shouldArchive = lastUpdated < archiveCutoff;
      
      // 应用筛选条件
      const matchesFilter = (!course_id || doc.course_id === course_id) && 
                           (!category || doc.category === category);

      if (shouldArchive && matchesFilter) {
        if (!dry_run) {
          doc.status = 'archived';
          doc.archived_at = now.toISOString();
          doc.archived_by = user.user_id;
          results.archived_count++;
          results.archived_list.push({
            doc_id: doc.doc_id,
            title: doc.title,
            course_id: doc.course_id
          });
        } else {
          results.archived_list.push({
            doc_id: doc.doc_id,
            title: doc.title,
            course_id: doc.course_id,
            last_updated: doc.upload_time
          });
        }
      }
    });

    // 清理已删除的文档（硬删除）
    const purgeCutoff = new Date();
    purgeCutoff.setDate(now.getDate() - purge_deleted_days);

    db.documents = db.documents.filter(doc => {
      if (doc.status !== 'deleted') return true; // 保留非删除状态的文档
      
      const deletedAt = new Date(doc.deleted_at);
      const canPurge = deletedAt < purgeCutoff;
      
      if (canPurge) {
        if (!dry_run) {
          results.purged_count++;
          results.purged_list.push({
            doc_id: doc.doc_id,
            title: doc.title,
            course_id: doc.course_id
          });
          return false; // 从数组中移除
        } else {
          results.purged_list.push({
            doc_id: doc.doc_id,
            title: doc.title,
            course_id: doc.course_id,
            deleted_at: doc.deleted_at
          });
          return true; // 在干运行中保留以供报告
        }
      }
      return true; // 保留待清理的文档
    });

    // 记录操作日志
    logAction(user.user_id, 'DOCUMENT_CLEANUP', 'system', {
      ...results,
      params: { archive_days, purge_deleted_days, course_id, category, dry_run }
    });

    return createSuccess(results);
  } catch (err) {
    console.error('清理文档失败:', err);
    return createError('内部服务器错误', 500);
  }
}

// --- 主处理器函数 ---
export default async function handler(event, context) {
  // 处理预检请求
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders
    };
  }

  // 提取路径
  const path = event.path.replace('/api/documents', '');
  
  // 路由处理
  if (path === '' || path === '/') {
    // GET /api/documents
    if (event.httpMethod === 'GET') {
      return await getDocuments(event);
    }
    // POST /api/documents
    else if (event.httpMethod === 'POST') {
      return await uploadDocument(event);
    }
  } 
  else if (path.startsWith('/')) {
    const parts = path.split('/').filter(p => p);
    
    if (parts.length === 1) {
      const doc_id = parts[0];
      
      // GET /api/documents/{doc_id}
      if (event.httpMethod === 'GET') {
        return await getDocumentById({ ...event, pathParameters: { doc_id } });
      }
      // PUT /api/documents/{doc_id}
      else if (event.httpMethod === 'PUT') {
        return await updateDocument({ ...event, pathParameters: { doc_id } });
      }
      // DELETE /api/documents/{doc_id}
      else if (event.httpMethod === 'DELETE') {
        return await deleteDocument({ ...event, pathParameters: { doc_id } });
      }
    } 
    else if (parts.length === 2) {
      const [doc_id, action] = parts;
      
      // GET /api/documents/{doc_id}/download
      if (action === 'download' && event.httpMethod === 'GET') {
        return await downloadDocument({ ...event, pathParameters: { doc_id } });
      }
      // POST /api/documents/{doc_id}/mark-important
      else if (action === 'mark-important' && event.httpMethod === 'POST') {
        return await markImportant({ ...event, pathParameters: { doc_id } });
      }
    }
    // GET /api/documents/important
    else if (parts.length === 1 && parts[0] === 'important' && event.httpMethod === 'GET') {
      return await getImportantDocuments(event);
    }
    // GET /api/documents/stats
    else if (parts.length === 1 && parts[0] === 'stats' && event.httpMethod === 'GET') {
      return await getDocumentStats(event);
    }
    // GET /api/documents/trends
    else if (parts.length === 1 && parts[0] === 'trends' && event.httpMethod === 'GET') {
      return await getUploadTrends(event);
    }
    // GET /api/documents/top-downloaded
    else if (parts.length === 1 && parts[0] === 'top-downloaded' && event.httpMethod === 'GET') {
      return await getTopDownloaded(event);
    }
    // POST /api/documents/cleanup
    else if (parts.length === 1 && parts[0] === 'cleanup' && event.httpMethod === 'POST') {
      return await cleanupDocuments(event);
    }
  }

  // 未匹配的路由
  return {
    statusCode: 404,
    headers: corsHeaders,
    body: JSON.stringify({ error: 'API 未找到' })
  };
}