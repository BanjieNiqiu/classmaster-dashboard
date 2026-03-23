/**
 * api/users.js
 * 
 * 用户认证与管理API接口模拟文件（前端纯模拟实现）
 * 提供登录、注册、用户信息获取等核心功能的本地模拟响应
 * 
 * @author AI Assistant
 * @date 2026-03-23
 */

/**
 * 模拟用户数据库（仅用于前端测试）
 */
const mockUsers = [
  {
    id: 1,
    username: 'admin',
    password: 'admin123', // 明文存储仅作演示，实际不应如此
    nickname: '管理员',
    email: 'admin@example.com',
    avatar: '/assets/avatar/admin.jpg',
    role: 'admin',
    createTime: '2024-01-01T00:00:00Z'
  },
  {
    id: 2,
    username: 'user',
    password: 'user123',
    nickname: '普通用户',
    email: 'user@example.com',
    avatar: '/assets/avatar/user.jpg',
    role: 'user',
    createTime: '2024-01-02T00:00:00Z'
  }
];

/**
 * 模拟JWT令牌
 */
const MOCK_TOKEN = 'mock_jwt_token_12345';

/**
 * 统一响应格式生成函数
 * @param {number} status - HTTP状态码
 * @param {string} message - 响应消息
 * @param {any} data - 返回数据（可选）
 * @returns {Object} 标准化响应对象
 */
const createResponse = (status, message, data = null) => ({
  status,
  message,
  data,
  timestamp: new Date().toISOString()
});

/**
 * POST /api/users/login
 * 用户登录接口
 * 
 * 请求体示例：
 * {
 *   "username": "admin",
 *   "password": "admin123"
 * }
 * 
 * @param {Object} body - 请求体数据
 * @returns {Promise<Object>} 模拟异步响应
 */
export const login = async (body) => {
  try {
    if (!body || !body.username || !body.password) {
      return createResponse(400, '用户名和密码不能为空', null);
    }

    const user = mockUsers.find(
      u => u.username === body.username && u.password === body.password
    );

    if (!user) {
      return createResponse(401, '用户名或密码错误', null);
    }

    // 成功登录，返回token和用户信息（敏感信息已过滤）
    const { password, ...safeUser } = user;
    return createResponse(200, '登录成功', {
      token: MOCK_TOKEN,
      user: safeUser
    });
  } catch (error) {
    console.error('Login error:', error);
    return createResponse(500, '服务器内部错误', null);
  }
};

/**
 * POST /api/users/register
 * 用户注册接口
 * 
 * 请求体示例：
 * {
 *   "username": "newuser",
 *   "password": "newpass123",
 *   "nickname": "新用户",
 *   "email": "new@example.com"
 * }
 * 
 * @param {Object} body - 请求体数据
 * @returns {Promise<Object>} 模拟异步响应
 */
export const register = async (body) => {
  try {
    if (!body || !body.username || !body.password) {
      return createResponse(400, '用户名和密码为必填项', null);
    }

    // 基础验证
    if (body.username.length < 3) {
      return createResponse(400, '用户名长度不能小于3位', null);
    }
    if (body.password.length < 6) {
      return createResponse(400, '密码长度不能小于6位', null);
    }

    // 检查用户名是否已存在
    const exists = mockUsers.some(u => u.username === body.username);
    if (exists) {
      return createResponse(400, '该用户名已被注册', null);
    }

    // 创建新用户（模拟）
    const newUser = {
      id: mockUsers.length + 1,
      username: body.username,
      password: body.password, // 实际项目中需加密
      nickname: body.nickname || body.username,
      email: body.email || '',
      avatar: '/assets/avatar/default.jpg',
      role: 'user',
      createTime: new Date().toISOString()
    };

    // 模拟写入（实际不持久化）
    mockUsers.push(newUser);

    const { password, ...safeUser } = newUser;
    return createResponse(200, '注册成功', {
      token: MOCK_TOKEN,
      user: safeUser
    });
  } catch (error) {
    console.error('Register error:', error);
    return createResponse(500, '服务器内部错误', null);
  }
};

/**
 * GET /api/users/profile
 * 获取当前用户信息接口
 * 
 * @param {string} token - 认证令牌（模拟使用）
 * @returns {Promise<Object>} 模拟异步响应
 */
export const getProfile = async (token) => {
  try {
    // 简单验证token
    if (!token || token !== MOCK_TOKEN) {
      return createResponse(401, '未授权访问，请先登录', null);
    }

    // 默认返回第一个用户信息（实际应根据token解析用户）
    const user = mockUsers[0];
    const { password, ...safeUser } = user;

    return createResponse(200, '获取用户信息成功', safeUser);
  } catch (error) {
    console.error('Get profile error:', error);
    return createResponse(500, '服务器内部错误', null);
  }
};

/**
 * GET /api/users/list
 * 获取用户列表（仅管理员可用）
 * 
 * @param {string} token - 认证令牌
 * @returns {Promise<Object>} 模拟异步响应
 */
export const getUserList = async (token) => {
  try {
    if (!token || token !== MOCK_TOKEN) {
      return createResponse(401, '未授权访问', null);
    }

    // 这里简单放行，实际应校验角色权限
    const userList = mockUsers.map(({ password, ...user }) => user);

    return createResponse(200, '获取用户列表成功', userList);
  } catch (error) {
    console.error('Get user list error:', error);
    return createResponse(500, '服务器内部错误', null);
  }
};

// 默认导出所有API函数
export default {
  login,
  register,
  getProfile,
  getUserList
};