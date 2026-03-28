/**
 * api/items.js - 物资共享与借用管理 Serverless Function
 * 实现完整的物资档案、状态管理、借用归还流程及班委管理功能
 * 部署于 Vercel Serverless Functions (/api/items)
 */

import { v4 as uuidv4 } from 'uuid';

// 模拟数据库连接（实际应替换为 MongoDB/Supabase 等）
const db = {
  items: [],
  borrow_records: []
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
 * 检查物品是否可被删除（不能处于借用中或待确认归还状态）
 * @param {Object} item - 物品对象
 * @returns {Object} 校验结果
 */
function canDeleteItem(item) {
  if ([1, 2].includes(item.status)) {
    return { ok: false, message: '无法删除正在借用或待确认归还的物品，请先完成归还流程。' };
  }
  return { ok: true };
}

/**
 * 检查物品是否可被借用（必须处于“可借用”状态）
 * @param {Object} item - 物品对象
 * @returns {Object} 校验结果
 */
function canBorrowItem(item) {
  if (item.status !== 0) {
    return { ok: false, message: `当前物品状态不可借用，当前状态：${['可借用', '已借出', '待确认归还'][item.status]}` };
  }
  return { ok: true };
}

/**
 * 检查物品是否可被归还（必须处于“已借出”状态且由借用人发起）
 * @param {Object} item - 物品对象
 * @param {string} userId - 当前用户ID
 * @returns {Object} 校验结果
 */
function canReturnItem(item, userId) {
  if (item.status !== 1) {
    return { ok: false, message: `只有“已借出”的物品才能发起归还，当前状态：${['可借用', '已借出', '待确认归还'][item.status]}` };
  }
  if (item.borrower_id !== userId) {
    return { ok: false, message: '只有借用人可以发起归还请求。' };
  }
  return { ok: true };
}

/**
 * 检查物品是否可被确认收回（必须处于“待确认归还”状态且由所有者发起）
 * @param {Object} item - 物品对象
 * @param {string} userId - 当前用户ID
 * @returns {Object} 校验结果
 */
function canConfirmReturn(item, userId) {
  if (item.status !== 2) {
    return { ok: false, message: `只有“待确认归还”的物品才能执行确认操作，当前状态：${['可借用', '已借出', '待确认归还'][item.status]}` };
  }
  if (item.owner_type === 'personal' && item.owner_id !== userId) {
    return { ok: false, message: '只有物品所有者可以确认归还。' };
  }
  if (item.owner_type === 'class' && !['monitor', 'admin'].includes(userId.role)) {
    return { ok: false, message: '只有班委或管理员可以确认班级公共物资的归还。' };
  }
  return { ok: true };
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

// --- 物资档案管理接口 ---

/**
 * GET /api/items - 获取物资列表，支持按状态、所有者类型、分类筛选
 */
export async function getItems(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { status, owner_type, name } = event.queryStringParameters || {};

    let filteredItems = db.items.filter(item => item.status !== 'deleted');

    if (status !== undefined) {
      const statusNum = parseInt(status, 10);
      if (![0, 1, 2].includes(statusNum)) {
        return createError('无效的状态值，应为 0(可借用), 1(已借出), 2(待确认归还)', 400);
      }
      filteredItems = filteredItems.filter(item => item.status === statusNum);
    }

    if (owner_type) {
      if (!['class', 'personal'].includes(owner_type)) {
        return createError('无效的所有者类型，应为 class 或 personal', 400);
      }
      filteredItems = filteredItems.filter(item => item.owner_type === owner_type);
    }

    if (name) {
      const lowerName = name.toLowerCase();
      filteredItems = filteredItems.filter(item => 
        item.name.toLowerCase().includes(lowerName)
      );
    }

    return createSuccess({ data: filteredItems });
  } catch (err) {
    console.error('获取物资列表失败:', err);
    return createError('无法获取物资列表', 500);
  }
}

/**
 * POST /api/items - 创建新的物资档案，支持班级公共物资和个人共享物资
 */
export async function createItem(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  if (!hasPermission(authResult.user.role, ['student', 'monitor', 'admin'])) {
    return createError('权限不足，无法创建物资', 403);
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { name, owner_type, description, image_url } = body;

    if (!name || name.trim().length === 0) {
      return createError('物资名称不能为空', 400);
    }

    if (!owner_type || !['class', 'personal'].includes(owner_type)) {
      return createError('必须指定有效的所有者类型（class 或 personal）', 400);
    }

    const newItem = {
      item_id: uuidv4(),
      name: name.trim(),
      owner_type,
      owner_id: owner_type === 'class' ? 'monitor_group' : authResult.user.user_id,
      status: 0, // 初始状态为可借用
      description: description || '',
      image_url: image_url || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    db.items.push(newItem);

    logAction(authResult.user.user_id, 'create_item', newItem.item_id, { name: newItem.name });

    return createSuccess(newItem, 201);
  } catch (err) {
    console.error('创建物资失败:', err);
    return createError('创建物资时发生错误', 500);
  }
}

/**
 * GET /api/items/{item_id} - 获取单个物资详情
 */
export async function getItemById(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { item_id } = event.pathParameters || {};
    if (!item_id) {
      return createError('缺少物资ID', 400);
    }

    const item = db.items.find(i => i.item_id === item_id && i.status !== 'deleted');
    if (!item) {
      return createError('物资未找到', 404);
    }

    return createSuccess(item);
  } catch (err) {
    console.error('获取物资详情失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * PUT /api/items/{item_id} - 更新物资信息
 */
export async function updateItem(event) {
  if (event.httpMethod !== 'PUT') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { item_id } = event.pathParameters || {};
    if (!item_id) {
      return createError('缺少物资ID', 400);
    }

    const item = db.items.find(i => i.item_id === item_id && i.status !== 'deleted');
    if (!item) {
      return createError('物资未找到', 404);
    }

    // 权限控制：个人物资只能由所有者修改，班级物资可由班委修改
    if (item.owner_type === 'personal' && item.owner_id !== authResult.user.user_id) {
      return createError('无权修改他人共享的物资', 403);
    }
    if (item.owner_type === 'class' && !['monitor', 'admin'].includes(authResult.user.role)) {
      return createError('只有班委或管理员可以修改班级公共物资', 403);
    }

    const body = JSON.parse(event.body || '{}');
    const { name, description, image_url } = body;

    if (name !== undefined) {
      if (name.trim().length === 0) {
        return createError('物资名称不能为空', 400);
      }
      item.name = name.trim();
    }

    if (description !== undefined) {
      item.description = description;
    }

    if (image_url !== undefined) {
      item.image_url = image_url;
    }

    item.updated_at = new Date().toISOString();

    logAction(authResult.user.user_id, 'update_item', item_id, { fields: Object.keys(body) });

    return createSuccess(item);
  } catch (err) {
    console.error('更新物资失败:', err);
    return createError('更新物资时发生错误', 500);
  }
}

/**
 * DELETE /api/items/{item_id} - 删除物资，删除前校验状态
 */
export async function deleteItem(event) {
  if (event.httpMethod !== 'DELETE') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  if (!hasPermission(authResult.user.role, ['monitor', 'admin'])) {
    return createError('权限不足，无法删除物资', 403);
  }

  try {
    const { item_id } = event.pathParameters || {};
    if (!item_id) {
      return createError('缺少物资ID', 400);
    }

    const itemIndex = db.items.findIndex(i => i.item_id === item_id);
    if (itemIndex === -1) {
      return createError('物资未找到', 404);
    }

    const item = db.items[itemIndex];

    // 状态校验
    const deleteCheck = canDeleteItem(item);
    if (!deleteCheck.ok) {
      return createError(deleteCheck.message, 400);
    }

    // 标记为已删除（软删除）
    item.status = 'deleted';
    item.deleted_at = new Date().toISOString();

    logAction(authResult.user.user_id, 'delete_item', item_id, { name: item.name });

    return createSuccess({ message: '物资已成功删除' });
  } catch (err) {
    console.error('删除物资失败:', err);
    return createError('删除物资时发生错误', 500);
  }
}

// --- 借用流程管理接口 ---

/**
 * POST /api/items/{item_id}/borrow - 发起借用请求
 */
export async function borrowItem(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  if (!hasPermission(authResult.user.role, ['student', 'monitor'])) {
    return createError('权限不足，无法借用物资', 403);
  }

  try {
    const { item_id } = event.pathParameters || {};
    if (!item_id) {
      return createError('缺少物资ID', 400);
    }

    const item = db.items.find(i => i.item_id === item_id && i.status !== 'deleted');
    if (!item) {
      return createError('物资未找到', 404);
    }

    // 状态校验
    const borrowCheck = canBorrowItem(item);
    if (!borrowCheck.ok) {
      return createError(borrowCheck.message, 400);
    }

    // 更新物品状态
    item.status = 1; // 已借出
    item.borrower_id = authResult.user.user_id;
    item.lender_id = item.owner_type === 'class' ? 'monitor_group' : item.owner_id;
    item.borrowed_at = new Date().toISOString();
    item.scheduled_return = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 默认7天后归还
    item.updated_at = new Date().toISOString();

    // 创建借用记录
    const record = {
      record_id: uuidv4(),
      item_id,
      borrower_id: authResult.user.user_id,
      lender_id: item.lender_id,
      actions: [
        {
          type: 'borrow',
          timestamp: new Date().toISOString(),
          status: 1,
          note: '成功借用',
          operator_id: authResult.user.user_id
        }
      ],
      scheduled_return: item.scheduled_return,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    db.borrow_records.push(record);

    logAction(authResult.user.user_id, 'borrow_item', item_id, { record_id: record.record_id });

    return createSuccess({
      message: '借用成功',
      item,
      record
    });
  } catch (err) {
    console.error('借用物资失败:', err);
    return createError('借用过程中发生错误', 500);
  }
}

/**
 * POST /api/items/{item_id}/return - 发起归还请求
 */
export async function returnItem(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  if (!hasPermission(authResult.user.role, ['student', 'monitor'])) {
    return createError('权限不足，无法归还物资', 403);
  }

  try {
    const { item_id } = event.pathParameters || {};
    if (!item_id) {
      return createError('缺少物资ID', 400);
    }

    const item = db.items.find(i => i.item_id === item_id && i.status !== 'deleted');
    if (!item) {
      return createError('物资未找到', 404);
    }

    // 状态和权限校验
    const returnCheck = canReturnItem(item, authResult.user.user_id);
    if (!returnCheck.ok) {
      return createError(returnCheck.message, 400);
    }

    // 更新物品状态
    item.status = 2; // 待确认归还
    item.return_requested_at = new Date().toISOString();
    item.updated_at = new Date().toISOString();

    // 查找对应的借用记录并更新
    const record = db.borrow_records.find(r => r.item_id === item_id && !r.actual_return);
    if (record) {
      record.actions.push({
        type: 'return_request',
        timestamp: new Date().toISOString(),
        status: 2,
        note: '用户发起归还请求',
        operator_id: authResult.user.user_id
      });
      record.updated_at = new Date().toISOString();
    }

    logAction(authResult.user.user_id, 'return_item', item_id, { record_id: record?.record_id });

    return createSuccess({
      message: '归还请求已提交，请等待物品所有者确认',
      item
    });
  } catch (err) {
    console.error('发起归还失败:', err);
    return createError('归还过程中发生错误', 500);
  }
}

/**
 * POST /api/items/{item_id}/confirm-return - 所有者确认归还
 */
export async function confirmReturn(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  if (!hasPermission(authResult.user.role, ['student', 'monitor', 'admin'])) {
    return createError('权限不足，无法确认归还', 403);
  }

  try {
    const { item_id } = event.pathParameters || {};
    if (!item_id) {
      return createError('缺少物资ID', 400);
    }

    const item = db.items.find(i => i.item_id === item_id && i.status !== 'deleted');
    if (!item) {
      return createError('物资未找到', 404);
    }

    // 状态和权限校验
    const confirmCheck = canConfirmReturn(item, authResult.user.user_id);
    if (!confirmCheck.ok) {
      return createError(confirmCheck.message, 400);
    }

    // 更新物品状态为可借用
    item.status = 0; // 可借用
    item.borrower_id = null;
    item.lender_id = null;
    item.borrowed_at = null;
    item.scheduled_return = null;
    item.return_requested_at = null;
    item.actual_return = new Date().toISOString();
    item.return_confirmed_by = authResult.user.user_id;
    item.return_confirmed_at = new Date().toISOString();
    item.updated_at = new Date().toISOString();

    // 更新借用记录
    const record = db.borrow_records.find(r => r.item_id === item_id && !r.actual_return);
    if (record) {
      record.actions.push({
        type: 'return_confirm',
        timestamp: new Date().toISOString(),
        status: 0,
        note: '所有者确认收回',
        operator_id: authResult.user.user_id
      });
      record.actual_return = new Date().toISOString();
      record.updated_at = new Date().toISOString();
    }

    logAction(authResult.user.user_id, 'confirm_return', item_id, { record_id: record?.record_id });

    return createSuccess({
      message: '已确认收回，该物品恢复为可借用状态',
      item
    });
  } catch (err) {
    console.error('确认归还失败:', err);
    return createError('确认归还过程中发生错误', 500);
  }
}

// --- 借用记录管理接口 ---

/**
 * GET /api/items/borrow-records - 获取借用历史记录，支持按物品、用户、时间筛选
 */
export async function getBorrowRecords(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { item_id, borrower_id, start_date, end_date } = event.queryStringParameters || {};

    let filteredRecords = [...db.borrow_records];

    if (item_id) {
      filteredRecords = filteredRecords.filter(r => r.item_id === item_id);
    }

    if (borrower_id) {
      filteredRecords = filteredRecords.filter(r => r.borrower_id === borrower_id);
    }

    if (start_date) {
      const startDate = new Date(start_date);
      if (isNaN(startDate.getTime())) {
        return createError('开始日期格式无效', 400);
      }
      filteredRecords = filteredRecords.filter(r => new Date(r.created_at) >= startDate);
    }

    if (end_date) {
      const endDate = new Date(end_date);
      if (isNaN(endDate.getTime())) {
        return createError('结束日期格式无效', 400);
      }
      filteredRecords = filteredRecords.filter(r => new Date(r.created_at) <= endDate);
    }

    return createSuccess({ data: filteredRecords });
  } catch (err) {
    console.error('获取借用记录失败:', err);
    return createError('无法获取借用记录', 500);
  }
}

/**
 * GET /api/items/{item_id}/borrow-history - 获取单个物品的借用历史
 */
export async function getItemBorrowHistory(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { item_id } = event.pathParameters || {};
    if (!item_id) {
      return createError('缺少物资ID', 400);
    }

    const history = db.borrow_records.filter(r => r.item_id === item_id);
    if (history.length === 0) {
      return createSuccess({ data: [], message: '暂无借用记录' });
    }

    return createSuccess({ data: history });
  } catch (err) {
    console.error('获取物品借用历史失败:', err);
    return createError('内部服务器错误', 500);
  }
}

// --- 个人管理接口 ---

/**
 * GET /api/users/{user_id}/borrowing - 获取用户当前借用中的物品清单
 */
export async function getUserBorrowing(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { user_id } = event.pathParameters || {};
    if (!user_id) {
      return createError('缺少用户ID', 400);
    }

    // 权限控制：用户只能查看自己的借用情况，管理员可查看所有人
    if (user_id !== authResult.user.user_id && !['monitor', 'admin'].includes(authResult.user.role)) {
      return createError('无权查看他人借用信息', 403);
    }

    const borrowingItems = db.items.filter(
      item => item.borrower_id === user_id && item.status === 1
    );

    return createSuccess({ data: borrowingItems });
  } catch (err) {
    console.error('获取用户借用清单失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * GET /api/users/{user_id}/lending - 获取用户共享给他人的物品及状态
 */
export async function getUserLending(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { user_id } = event.pathParameters || {};
    if (!user_id) {
      return createError('缺少用户ID', 400);
    }

    // 权限控制
    if (user_id !== authResult.user.user_id && !['monitor', 'admin'].includes(authResult.user.role)) {
      return createError('无权查看他人共享信息', 403);
    }

    let lendingItems = [];

    if (authResult.user.role === 'admin' || user_id === 'monitor_group') {
      // 班委查看班级物资
      lendingItems = db.items.filter(
        item => item.owner_type === 'class' && [1, 2].includes(item.status)
      );
    } else {
      // 普通用户查看自己共享的物品
      lendingItems = db.items.filter(
        item => item.owner_type === 'personal' && item.owner_id === user_id && [1, 2].includes(item.status)
      );
    }

    return createSuccess({ data: lendingItems });
  } catch (err) {
    console.error('获取用户共享清单失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * GET /api/users/{user_id}/borrow-history - 获取用户历史借用记录
 */
export async function getUserBorrowHistory(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { user_id } = event.pathParameters || {};
    if (!user_id) {
      return createError('缺少用户ID', 400);
    }

    if (user_id !== authResult.user.user_id && !['monitor', 'admin'].includes(authResult.user.role)) {
      return createError('无权查看他人借用历史', 403);
    }

    const records = db.borrow_records.filter(r => r.borrower_id === user_id);
    return createSuccess({ data: records });
  } catch (err) {
    console.error('获取用户借用历史失败:', err);
    return createError('内部服务器错误', 500);
  }
}

// --- 班委管理功能接口 ---

/**
 * GET /api/items/class-assets - 获取所有班级公共物资的去向明细
 */
export async function getClassAssets(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  if (!hasPermission(authResult.user.role, ['monitor', 'admin'])) {
    return createError('仅班委和管理员可查看班级资产明细', 403);
  }

  try {
    const classItems = db.items
      .filter(item => item.owner_type === 'class')
      .map(item => {
        const isBorrowed = [1, 2].includes(item.status);
        return {
          ...item,
          current_status_label: ['可借用', '已借出', '待确认归还'][item.status],
          is_borrowed: isBorrowed,
          borrower_info: isBorrowed ? db.users?.find(u => u.user_id === item.borrower_id) : null
        };
      });

    return createSuccess({ data: classItems });
  } catch (err) {
    console.error('获取班级资产明细失败:', err);
    return createError('内部服务器错误', 500);
  }
}

/**
 * GET /api/items/class-assets/export - 将班级物资清单导出为Excel
 * 注意：此接口在Serverless环境中通常返回下载链接而非直接流式输出
 */
export async function exportClassAssets(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  if (!hasPermission(authResult.user.role, ['monitor', 'admin'])) {
    return createError('仅班委和管理员可导出班级资产清单', 403);
  }

  try {
    // 实际实现中应使用 exceljs 或 sheetjs 生成 Excel 文件，并上传至临时存储返回链接
    // 此处模拟返回一个假的下载链接
    const downloadUrl = `/temp/class_assets_${Date.now()}.xlsx`;

    logAction(authResult.user.user_id, 'export_class_assets', 'all', { url: downloadUrl });

    return createSuccess({
      message: '班级物资清单已生成',
      download_url: downloadUrl,
      expires_at: new Date(Date.now() + 3600000).toISOString() // 1小时后过期
    });
  } catch (err) {
    console.error('导出班级资产清单失败:', err);
    return createError('生成导出文件时发生错误', 500);
  }
}

/**
 * 主处理器函数，根据路径和方法分发请求
 */
export default async function handler(event, context) {
  const { httpMethod, path } = event;

  // 处理预检请求
  if (httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders };
  }

  // 路径路由
  if (path === '/api/items') {
    if (httpMethod === 'GET') return await getItems(event);
    if (httpMethod === 'POST') return await createItem(event);
  } else if (path.startsWith('/api/items/') && path.endsWith('/borrow')) {
    const itemId = path.split('/')[3];
    if (!itemId) return createError('无效的物资ID', 400);
    event.pathParameters = { item_id: itemId };
    if (httpMethod === 'POST') return await borrowItem(event);
  } else if (path.startsWith('/api/items/') && path.endsWith('/return')) {
    const itemId = path.split('/')[3];
    if (!itemId) return createError('无效的物资ID', 400);
    event.pathParameters = { item_id: itemId };
    if (httpMethod === 'POST') return await returnItem(event);
  } else if (path.startsWith('/api/items/') && path.endsWith('/confirm-return')) {
    const itemId = path.split('/')[3];
    if (!itemId) return createError('无效的物资ID', 400);
    event.pathParameters = { item_id: itemId };
    if (httpMethod === 'POST') return await confirmReturn(event);
  } else if (path === '/api/items/borrow-records') {
    if (httpMethod === 'GET') return await getBorrowRecords(event);
  } else if (path.startsWith('/api/items/class-assets') && path === '/api/items/class-assets') {
    if (httpMethod === 'GET') return await getClassAssets(event);
  } else if (path.startsWith('/api/items/class-assets') && path === '/api/items/class-assets/export') {
    if (httpMethod === 'GET') return await exportClassAssets(event);
  } else if (path.match(/^\/api\/items\/[^\/]+$/)) {
    const itemId = path.split('/')[3];
    event.pathParameters = { item_id: itemId };
    if (httpMethod === 'GET') return await getItemById(event);
    if (httpMethod === 'PUT') return await updateItem(event);
    if (httpMethod === 'DELETE') return await deleteItem(event);
  } else if (path.match(/^\/api\/items\/[^\/]+\/borrow-history$/)) {
    const itemId = path.split('/')[3];
    event.pathParameters = { item_id: itemId };
    if (httpMethod === 'GET') return await getItemBorrowHistory(event);
  } else if (path.match(/^\/api\/users\/[^\/]+\/borrowing$/)) {
    const userId = path.split('/')[3];
    event.pathParameters = { user_id: userId };
    if (httpMethod === 'GET') return await getUserBorrowing(event);
  } else if (path.match(/^\/api\/users\/[^\/]+\/lending$/)) {
    const userId = path.split('/')[3];
    event.pathParameters = { user_id: userId };
    if (httpMethod === 'GET') return await getUserLending(event);
  } else if (path.match(/^\/api\/users\/[^\/]+\/borrow-history$/)) {
    const userId = path.split('/')[3];
    event.pathParameters = { user_id: userId };
    if (httpMethod === 'GET') return await getUserBorrowHistory(event);
  }

  return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: '接口未找到' }) };
}