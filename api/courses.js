/**
 * api/courses.js - 课程情报与作业查询 Serverless Function
 * 实现课程信息管理、作业/考试安排发布及时间敏感提醒功能
 * 部署于 Vercel Serverless Functions (/api/courses)
 */

import { v4 as uuidv4 } from 'uuid';

// 模拟数据库连接（实际应替换为 MongoDB/Supabase 等）
const db = {
  courses: [],
  intel: []
};

// 当前时间常量，用于时间敏感判断
const NOW = new Date('2026-03-23T00:00:00Z');

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
    const payloadStr = Buffer.from(token.split('.')[1], 'base64').toString();
    const payload = JSON.parse(payloadStr);

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
function checkPermission(userRole, requiredRoles) {
  const roleHierarchy = ['guest', 'student', 'monitor', 'admin'];
  const userLevel = roleHierarchy.indexOf(userRole);
  return requiredRoles.some(role => roleHierarchy.indexOf(role) <= userLevel);
}

/**
 * 时间敏感检查：判断任务是否即将在48小时内截止
 * @param {string} deadline - 截止时间（ISO8601格式）
 * @returns {boolean} 是否为紧急状态
 */
function isUrgent(deadline) {
  if (!deadline) return false;
  const deadlineDate = new Date(deadline);
  if (isNaN(deadlineDate.getTime())) return false;
  const diffMs = deadlineDate - NOW;
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours > 0 && diffHours < 48; // 小于48小时且大于0
}

/**
 * 检查任务是否已过期
 * @param {string} deadline - 截止时间（ISO8601格式）
 * @returns {boolean} 是否已过期
 */
function isExpired(deadline) {
  if (!deadline) return false;
  const deadlineDate = new Date(deadline);
  if (isNaN(deadlineDate.getTime())) return false;
  return deadlineDate < NOW;
}

/**
 * 课程数据验证
 * @param {Object} courseData - 待验证的课程数据
 * @returns {Object} 验证结果 { valid: boolean, errors: string[] }
 */
function validateCourseData(courseData) {
  const errors = [];

  if (!courseData.name || courseData.name.trim().length === 0) {
    errors.push('课程名称不能为空');
  }

  if (!courseData.code || courseData.code.trim().length === 0) {
    errors.push('课程代码不能为空');
  }

  if (!courseData.teacher || courseData.teacher.trim().length === 0) {
    errors.push('授课教师不能为空');
  }

  if (!courseData.semester || courseData.semester.trim().length === 0) {
    errors.push('学期信息不能为空');
  }

  if (courseData.credits !== undefined && (isNaN(Number(courseData.credits)) || Number(courseData.credits) <= 0)) {
    errors.push('学分必须是大于0的数字');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 情报数据验证
 * @param {Object} intelData - 待验证的情报数据
 * @returns {Object} 验证结果 { valid: boolean, errors: string[] }
 */
function validateIntelData(intelData) {
  const errors = [];
  const validTypes = ['homework', 'exam', 'notice', 'resource'];

  if (!intelData.type || !validTypes.includes(intelData.type)) {
    errors.push(`类型必须是 ${validTypes.join(', ')} 之一`);
  }

  if (!intelData.title || intelData.title.trim().length === 0) {
    errors.push('标题不能为空');
  }

  if (!intelData.content || intelData.content.trim().length === 0) {
    errors.push('内容不能为空');
  }

  if (intelData.deadline) {
    const deadlineDate = new Date(intelData.deadline);
    if (isNaN(deadlineDate.getTime())) {
      errors.push('截止时间格式无效');
    }
  }

  if (intelData.source_url && typeof intelData.source_url === 'string') {
    try {
      new URL(intelData.source_url);
    } catch {
      errors.push('来源链接格式无效');
    }
  }

  if (intelData.verified_status && !['pending', 'verified', 'rejected'].includes(intelData.verified_status)) {
    errors.push('核实状态必须是 pending, verified 或 rejected');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 分页处理工具函数
 * @param {Array} list - 原始数据列表
 * @param {number} page - 当前页码
 * @param {number} size - 每页大小
 * @returns {Object} 分页结果 { data, total, page, size, totalPages }
 */
function paginate(list, page = 1, size = 10) {
  const total = list.length;
  const totalPages = Math.ceil(total / size);
  const offset = (page - 1) * size;
  const data = list.slice(offset, offset + size);

  return {
    data,
    total,
    page,
    size,
    totalPages
  };
}

// --- 初始化模拟数据 ---
(function initMockData() {
  // 模拟用户数据
  db.users = [
    { user_id: 'u001', name: '张三', role: 'student', status: 'active' },
    { user_id: 'u002', name: '李四', role: 'monitor', status: 'active' },
    { user_id: 'u003', name: '王五', role: 'admin', status: 'active' },
    { user_id: 'u004', name: '赵六', role: 'student', status: 'active' }
  ];

  // 模拟课程数据
  db.courses = [
    {
      course_id: 'MA202',
      name: '高等数学II',
      code: 'MA202',
      teacher: '王教授',
      semester: '2025-Spring',
      credits: 4.0,
      time: '周一 1-2节',
      location: '教一-101',
      created_at: '2025-03-01T08:00:00Z',
      updated_at: '2025-03-01T08:00:00Z',
      deleted: false
    },
    {
      course_id: 'CS205',
      name: '数据结构与算法',
      code: 'CS205',
      teacher: '李博士',
      semester: '2025-Spring',
      credits: 3.5,
      time: '周二 3-4节',
      location: '计楼-305',
      created_at: '2025-03-02T08:00:00Z',
      updated_at: '2025-03-02T08:00:00Z',
      deleted: false
    },
    {
      course_id: 'PH101',
      name: '大学物理B',
      code: 'PH101',
      teacher: '赵讲师',
      semester: '2024-Fall',
      credits: 3.0,
      time: '周三 5-6节',
      location: '理楼-202',
      created_at: '2024-09-01T08:00:00Z',
      updated_at: '2024-09-01T08:00:00Z',
      deleted: false
    },
    {
      course_id: 'EN102',
      name: '学术英语II',
      code: 'EN102',
      teacher: 'Smith',
      semester: '2025-Spring',
      credits: 2.0,
      time: '周四 7-8节',
      location: '外语馆-404',
      created_at: '2025-03-03T08:00:00Z',
      updated_at: '2025-03-03T08:00:00Z',
      deleted: false
    }
  ];

  // 模拟情报数据
  db.intel = [
    {
      intel_id: 'i001',
      course_id: 'MA202',
      type: 'homework',
      title: '第三章习题 3.1 - 3.5',
      content: '完成课本第三章课后习题，需手写提交至学习委员处。',
      deadline: new Date(NOW.getTime() + 86400000 * 2).toISOString(), // 2天后
      source_url: '',
      upvotes: 12,
      verified_status: 'verified',
      created_at: new Date(NOW.getTime() - 3600000).toISOString(),
      updated_at: new Date(NOW.getTime() - 3600000).toISOString(),
      author_id: 'u002',
      urgent: false
    },
    {
      intel_id: 'i002',
      course_id: 'CS205',
      type: 'exam',
      title: '期中考试安排',
      content: '期中考试定于第8周周五下午进行，范围涵盖链表、栈和队列。',
      deadline: new Date(NOW.getTime() + 86400000 * 15).toISOString(), // 15天后
      source_url: 'http://exam.edu',
      upvotes: 45,
      verified_status: 'verified',
      created_at: new Date(NOW.getTime() - 86400000 * 3).toISOString(),
      updated_at: new Date(NOW.getTime() - 86400000 * 3).toISOString(),
      author_id: 'u003',
      urgent: false
    },
    {
      intel_id: 'i003',
      course_id: 'MA202',
      type: 'notice',
      title: '调课通知',
      content: '本周一的高数课调至周三晚上，地点不变。',
      deadline: '',
      source_url: '',
      upvotes: 5,
      verified_status: 'pending',
      created_at: new Date(NOW.getTime() - 1800000).toISOString(),
      updated_at: new Date(NOW.getTime() - 1800000).toISOString(),
      author_id: 'u001',
      urgent: false
    }
  ];

  // 初始计算紧急状态
  db.intel.forEach(item => {
    item.urgent = isUrgent(item.deadline);
  });
})();

// --- 课程管理接口 ---

/**
 * GET /api/courses - 获取课程列表，支持按学期、搜索关键词、分页等参数筛选
 */
export async function getCourses(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { semester, search, page = 1, size = 10 } = event.queryStringParameters || {};

    let filteredCourses = db.courses.filter(c => !c.deleted);

    // 学期筛选
    if (semester && semester !== 'all') {
      filteredCourses = filteredCourses.filter(c => c.semester === semester);
    }

    // 搜索关键词筛选（匹配课程名、教师名、课程代码）
    if (search) {
      const lowerSearch = search.toLowerCase();
      filteredCourses = filteredCourses.filter(c =>
        c.name.toLowerCase().includes(lowerSearch) ||
        c.teacher.toLowerCase().includes(lowerSearch) ||
        c.code.toLowerCase().includes(lowerSearch)
      );
    }

    // 分页处理
    const paginated = paginate(filteredCourses, parseInt(page), parseInt(size));

    // 移除敏感字段
    const sanitizedData = {
      ...paginated,
      data: paginated.data.map(({ deleted, ...rest }) => rest)
    };

    return createSuccess(sanitizedData);
  } catch (err) {
    console.error('获取课程列表失败:', err);
    return createError('无法获取课程列表', 500);
  }
}

/**
 * GET /api/courses/{courseId} - 获取单个课程详情
 */
export async function getCourseById(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { courseId } = event.pathParameters || {};
    if (!courseId) {
      return createError('缺少课程ID', 400);
    }

    const course = db.courses.find(c => c.course_id === courseId && !c.deleted);
    if (!course) {
      return createError('课程未找到', 404);
    }

    // 移除敏感字段
    const { deleted, ...sanitizedCourse } = course;
    return createSuccess(sanitizedCourse);
  } catch (err) {
    console.error('获取课程详情失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * POST /api/courses - 创建新课程（需要班委或管理员权限）
 */
export async function createCourse(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  // 权限检查：只有班委及以上角色可以创建课程
  if (!checkPermission(authResult.user.role, ['monitor', 'admin'])) {
    return createError('权限不足，只有班委及以上角色可以创建课程', 403);
  }

  try {
    const body = JSON.parse(event.body || '{}');

    // 数据验证
    const validation = validateCourseData(body);
    if (!validation.valid) {
      return createError(`课程数据无效: ${validation.errors.join('; ')}`, 400);
    }

    const newCourse = {
      course_id: uuidv4(),
      name: body.name.trim(),
      code: body.code.trim(),
      teacher: body.teacher.trim(),
      semester: body.semester.trim(),
      credits: body.credits ? Number(body.credits) : undefined,
      time: body.time,
      location: body.location,
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      deleted: false
    };

    db.courses.push(newCourse);

    // 记录操作日志
    console.log(`[AUDIT] 用户 ${authResult.user.user_id} 创建了新课程: ${newCourse.course_id}`);

    // 返回脱敏数据
    const { deleted, ...responseCourse } = newCourse;
    return createSuccess(responseCourse, 201);
  } catch (err) {
    console.error('创建课程失败:', err);
    return createError('创建课程时发生错误', 500);
  }
}

/**
 * PUT /api/courses/{courseId} - 更新课程信息（需要创建者或管理员权限）
 */
export async function updateCourse(event) {
  if (event.httpMethod !== 'PUT') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { courseId } = event.pathParameters || {};
    if (!courseId) {
      return createError('缺少课程ID', 400);
    }

    const course = db.courses.find(c => c.course_id === courseId && !c.deleted);
    if (!course) {
      return createError('课程未找到', 404);
    }

    // 权限检查：只有管理员可以编辑课程（根据业务逻辑设定）
    if (authResult.user.role !== 'admin' && !checkPermission(authResult.user.role, ['monitor'])) {
      return createError('只有班委或管理员可以编辑课程信息', 403);
    }

    const body = JSON.parse(event.body || '{}');

    // 如果提供了更新的数据，进行验证
    if (Object.keys(body).length > 0) {
      const validation = validateCourseData({ ...course, ...body });
      if (!validation.valid) {
        return createError(`课程数据无效: ${validation.errors.join('; ')}`, 400);
      }

      // 更新允许的字段
      if (body.name !== undefined) course.name = body.name.trim();
      if (body.code !== undefined) course.code = body.code.trim();
      if (body.teacher !== undefined) course.teacher = body.teacher.trim();
      if (body.semester !== undefined) course.semester = body.semester.trim();
      if (body.credits !== undefined) course.credits = Number(body.credits);
      if (body.time !== undefined) course.time = body.time;
      if (body.location !== undefined) course.location = body.location;
    }

    course.updated_at = NOW.toISOString();

    // 记录操作日志
    console.log(`[AUDIT] 用户 ${authResult.user.user_id} 更新了课程: ${courseId}`);

    // 返回脱敏数据
    const { deleted, ...responseCourse } = course;
    return createSuccess(responseCourse);
  } catch (err) {
    console.error('更新课程失败:', err);
    return createError('更新课程时发生错误', 500);
  }
}

/**
 * DELETE /api/courses/{courseId} - 删除课程（软删除，需要班委或管理员权限）
 */
export async function deleteCourse(event) {
  if (event.httpMethod !== 'DELETE') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { courseId } = event.pathParameters || {};
    if (!courseId) {
      return createError('缺少课程ID', 400);
    }

    const course = db.courses.find(c => c.course_id === courseId && !c.deleted);
    if (!course) {
      return createError('课程未找到', 404);
    }

    // 权限检查：只有班委或管理员可以删除课程
    if (!checkPermission(authResult.user.role, ['monitor', 'admin'])) {
      return createError('权限不足，只有班委或管理员可以删除课程', 403);
    }

    // 二次确认通过请求头传递
    const confirmHeader = event.headers['x-confirm-delete'] || event.headers['X-Confirm-Delete'];
    if (!confirmHeader || confirmHeader !== 'true') {
      return createError('删除操作需要二次确认，请在请求头中添加 X-Confirm-Delete: true', 400);
    }

    // 软删除
    course.deleted = true;
    course.deleted_at = NOW.toISOString();
    course.updated_at = NOW.toISOString();

    // 同时标记该课程下所有情报为删除状态（可选）
    db.intel
      .filter(i => i.course_id === courseId)
      .forEach(i => {
        i.deleted = true;
        i.updated_at = NOW.toISOString();
      });

    // 记录操作日志
    console.log(`[AUDIT] 用户 ${authResult.user.user_id} 删除了课程: ${courseId}`);

    return createSuccess({ message: '课程已成功删除' });
  } catch (err) {
    console.error('删除课程失败:', err);
    return createError('删除课程时发生错误', 500);
  }
}

// --- 情报管理接口 ---

/**
 * GET /api/courses/{courseId}/intel - 获取课程情报列表，支持按类型、状态、紧急状态筛选，支持分页
 */
export async function getIntelligenceList(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { courseId } = event.pathParameters || {};
    if (!courseId) {
      return createError('缺少课程ID', 400);
    }

    // 验证课程是否存在
    const course = db.courses.find(c => c.course_id === courseId && !c.deleted);
    if (!course) {
      return createError('课程未找到', 404);
    }

    let filteredIntel = db.intel.filter(i => i.course_id === courseId && !i.deleted);

    // 参数提取
    const { 
      type, 
      verified: verifiedParam, 
      urgent: urgentParam, 
      page = 1, 
      size = 10 
    } = event.queryStringParameters || {};

    // 类型筛选
    if (type && type !== 'all') {
      filteredIntel = filteredIntel.filter(i => i.type === type);
    }

    // 核实状态筛选
    if (verifiedParam !== undefined) {
      if (verifiedParam === 'true') {
        filteredIntel = filteredIntel.filter(i => i.verified_status === 'verified');
      } else if (verifiedParam === 'false') {
        filteredIntel = filteredIntel.filter(i => i.verified_status !== 'verified');
      }
    }

    // 紧急状态筛选
    if (urgentParam !== undefined) {
      if (urgentParam === 'true') {
        filteredIntel = filteredIntel.filter(i => i.urgent === true);
      } else if (urgentParam === 'false') {
        filteredIntel = filteredIntel.filter(i => i.urgent === false);
      }
    }

    // 自动更新紧急状态（基于当前时间）
    let hasUpdatedUrgency = false;
    filteredIntel.forEach(item => {
      const wasUrgent = item.urgent;
      item.urgent = isUrgent(item.deadline);
      if (wasUrgent !== item.urgent) {
        item.updated_at = NOW.toISOString();
        hasUpdatedUrgency = true;
      }
    });

    if (hasUpdatedUrgency) {
      console.log('已自动更新紧急状态');
    }

    // 排序：按创建时间倒序
    filteredIntel.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // 分页处理
    const paginated = paginate(filteredIntel, parseInt(page), parseInt(size));

    return createSuccess(paginated);
  } catch (err) {
    console.error('获取情报列表失败:', err);
    return createError('无法获取情报列表', 500);
  }
}

/**
 * GET /api/courses/{courseId}/intel/{intelId} - 获取单个情报详情
 */
export async function getIntelById(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { courseId, intelId } = event.pathParameters || {};
    if (!courseId || !intelId) {
      return createError('缺少课程ID或情报ID', 400);
    }

    // 验证课程
    const course = db.courses.find(c => c.course_id === courseId && !c.deleted);
    if (!course) {
      return createError('课程未找到', 404);
    }

    const intel = db.intel.find(i => i.intel_id === intelId && i.course_id === courseId && !i.deleted);
    if (!intel) {
      return createError('情报未找到', 404);
    }

    // 自动更新紧急状态
    const wasUrgent = intel.urgent;
    intel.urgent = isUrgent(intel.deadline);
    if (wasUrgent !== intel.urgent) {
      intel.updated_at = NOW.toISOString();
    }

    return createSuccess(intel);
  } catch (err) {
    console.error('获取情报详情失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * POST /api/courses/{courseId}/intel - 发布新情报（需要学生以上权限）
 */
export async function postIntelligence(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  // 权限检查：学生及以上角色可以发布情报
  if (!checkPermission(authResult.user.role, ['student', 'monitor', 'admin'])) {
    return createError('权限不足，无法发布情报', 403);
  }

  try {
    const { courseId } = event.pathParameters || {};
    if (!courseId) {
      return createError('缺少课程ID', 400);
    }

    // 验证课程存在性
    const course = db.courses.find(c => c.course_id === courseId && !c.deleted);
    if (!course) {
      return createError('课程未找到', 404);
    }

    const body = JSON.parse(event.body || '{}');

    // 数据验证
    const validation = validateIntelData(body);
    if (!validation.valid) {
      return createError(`情报数据无效: ${validation.errors.join('; ')}`, 400);
    }

    const newIntel = {
      intel_id: uuidv4(),
      course_id: courseId,
      type: body.type,
      title: body.title.trim(),
      content: body.content.trim(),
      deadline: body.deadline || '',
      source_url: body.source_url || '',
      upvotes: 0,
      verified_status: 'pending', // 新发布的情报默认为待核实
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      author_id: authResult.user.user_id,
      urgent: isUrgent(body.deadline),
      deleted: false
    };

    db.intel.push(newIntel);

    // 记录操作日志
    console.log(`[AUDIT] 用户 ${authResult.user.user_id} 在课程 ${courseId} 发布了新情报: ${newIntel.intel_id}`);

    return createSuccess(newIntel, 201);
  } catch (err) {
    console.error('发布情报失败:', err);
    return createError('发布情报时发生错误', 500);
  }
}

/**
 * PUT /api/courses/{courseId}/intel/{intelId} - 更新情报（需要作者、班委或管理员权限）
 */
export async function updateIntelligence(event) {
  if (event.httpMethod !== 'PUT') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { courseId, intelId } = event.pathParameters || {};
    if (!courseId || !intelId) {
      return createError('缺少课程ID或情报ID', 400);
    }

    // 验证课程
    const course = db.courses.find(c => c.course_id === courseId && !c.deleted);
    if (!course) {
      return createError('课程未找到', 404);
    }

    const intel = db.intel.find(i => i.intel_id === intelId && i.course_id === courseId && !i.deleted);
    if (!intel) {
      return createError('情报未找到', 404);
    }

    // 权限检查：作者、班委或管理员可以编辑
    if (
      intel.author_id !== authResult.user.user_id &&
      !checkPermission(authResult.user.role, ['monitor', 'admin'])
    ) {
      return createError('只有作者、班委或管理员可以编辑此情报', 403);
    }

    // 已核实的情报不能由普通作者修改
    if (
      intel.verified_status === 'verified' &&
      intel.author_id === authResult.user.user_id &&
      !checkPermission(authResult.user.role, ['monitor', 'admin'])
    ) {
      return createError('已核实的情报不能由原作者修改，请联系班委', 403);
    }

    const body = JSON.parse(event.body || '{}');

    // 如果提供了更新的数据，进行验证
    if (Object.keys(body).length > 0) {
      const validation = validateIntelData({ ...intel, ...body });
      if (!validation.valid) {
        return createError(`情报数据无效: ${validation.errors.join('; ')}`, 400);
      }

      // 更新允许的字段
      if (body.type !== undefined) intel.type = body.type;
      if (body.title !== undefined) intel.title = body.title.trim();
      if (body.content !== undefined) intel.content = body.content.trim();
      if (body.deadline !== undefined) {
        intel.deadline = body.deadline || '';
        // 重新计算紧急状态
        intel.urgent = isUrgent(intel.deadline);
      }
      if (body.source_url !== undefined) intel.source_url = body.source_url || '';
    }

    intel.updated_at = NOW.toISOString();

    // 记录操作日志
    console.log(`[AUDIT] 用户 ${authResult.user.user_id} 更新了情报: ${intelId}`);

    return createSuccess(intel);
  } catch (err) {
    console.error('更新情报失败:', err);
    return createError('更新情报时发生错误', 500);
  }
}

/**
 * DELETE /api/courses/{courseId}/intel/{intelId} - 删除情报（需要作者、班委或管理员权限）
 */
export async function deleteIntelligence(event) {
  if (event.httpMethod !== 'DELETE') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  try {
    const { courseId, intelId } = event.pathParameters || {};
    if (!courseId || !intelId) {
      return createError('缺少课程ID或情报ID', 400);
    }

    // 验证课程
    const course = db.courses.find(c => c.course_id === courseId && !c.deleted);
    if (!course) {
      return createError('课程未找到', 404);
    }

    const intelIndex = db.intel.findIndex(i => i.intel_id === intelId && i.course_id === courseId && !i.deleted);
    if (intelIndex === -1) {
      return createError('情报未找到', 404);
    }

    const intel = db.intel[intelIndex];

    // 权限检查：作者、班委或管理员可以删除
    if (
      intel.author_id !== authResult.user.user_id &&
      !checkPermission(authResult.user.role, ['monitor', 'admin'])
    ) {
      return createError('只有作者、班委或管理员可以删除此情报', 403);
    }

    // 二次确认
    const confirmHeader = event.headers['x-confirm-delete'] || event.headers['X-Confirm-Delete'];
    if (!confirmHeader || confirmHeader !== 'true') {
      return createError('删除操作需要二次确认，请在请求头中添加 X-Confirm-Delete: true', 400);
    }

    // 软删除
    intel.deleted = true;
    intel.deleted_at = NOW.toISOString();
    intel.updated_at = NOW.toISOString();

    // 记录操作日志
    console.log(`[AUDIT] 用户 ${authResult.user.user_id} 删除了情报: ${intelId}`);

    return createSuccess({ message: '情报已成功删除' });
  } catch (err) {
    console.error('删除情报失败:', err);
    return createError('删除情报时发生错误', 500);
  }
}

/**
 * POST /api/courses/{courseId}/intel/{intelId}/verify - 班委可标记情报为verified或rejected状态
 */
export async function verifyIntelligence(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.statusCode) return authResult;

  // 权限检查：只有班委或管理员可以核实情报
  if (!checkPermission(authResult.user.role, ['monitor', 'admin'])) {
    return createError('权限不足，只有班委或管理员可以核实情报', 403);
  }

  try {
    const { courseId, intelId } = event.pathParameters || {};
    if (!courseId || !intelId) {
      return createError('缺少课程ID或情报ID', 400);
    }

    // 验证课程
    const course = db.courses.find(c => c.course_id === courseId && !c.deleted);
    if (!course) {
      return createError('课程未找到', 404);
    }

    const intel = db.intel.find(i => i.intel_id === intelId && i.course_id === courseId && !i.deleted);
    if (!intel) {
      return createError('情报未找到', 404);
    }

    const body = JSON.parse(event.body || '{}');
    const { action } = body;

    if (!action || !['verify', 'reject'].includes(action)) {
      return createError('操作必须是 verify 或 reject', 400);
    }

    // 更新核实状态
    intel.verified_status = action === 'verify' ? 'verified' : 'rejected';
    intel.verified_by = authResult.user.user_id;
    intel.verified_at = NOW.toISOString();
    intel.updated_at = NOW.toISOString();

    // 记录操作日志
    console.log(`[AUDIT] 用户 ${authResult.user.user_id} 将情报 ${intelId} 标记为 ${intel.verified_status}`);

    return createSuccess({
      message: `情报已成功标记为${intel.verified_status}`,
      verified_status: intel.verified_status
    });
  } catch (err) {
    console.error('核实情报失败:', err);
    return createError('核实情报时发生错误', 500);
  }
}