// api/utils.js
import { MongoClient, ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';

let dbInstance = null;

/**
 * 获取数据库实例
 * @returns {Promise<Object>} MongoDB数据库实例
 */
export async function getDatabase() {
  if (dbInstance) {
    return dbInstance;
  }

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.DATABASE_NAME || 'class_affairs_db';

  if (!uri) {
    throw new Error('MONGODB_URI 环境变量未定义');
  }

  try {
    console.log('正在连接到 MongoDB...');
    const client = new MongoClient(uri);
    await client.connect();
    dbInstance = client.db(dbName);
    console.log('MongoDB 连接成功');
    return dbInstance;
  } catch (error) {
    console.error('MongoDB 连接失败:', error);
    throw error;
  }
}

/**
 * 身份验证中间件
 * @param {Object} req - HTTP请求对象
 * @param {string} minRole - 最低所需角色 ('guest', 'student', 'monitor', 'admin')
 * @returns {Promise<Object>} 解析后的用户信息
 */
export async function authenticate(event, minRole = 'student') {
  const authHeader =
    event?.headers?.authorization ||
    event?.headers?.Authorization ||
    event?.headers?.AUTHORIZATION;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: '缺少或无效的身份令牌' };
  }

  const token = authHeader.split(' ')[1];

  try {
    // 从环境变量获取JWT密钥
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET 环境变量未定义');
    }

    const decoded = jwt.verify(token, jwtSecret);
    const db = await getDatabase();
    const userCollection = db.collection('users');

    // 从数据库获取最新用户信息
    const user = await userCollection.findOne({ _id: new ObjectId(decoded.userId) });

    if (!user) {
      return { error: '用户不存在' };
    }

    // 检查权限
    const roleHierarchy = { guest: 0, student: 1, monitor: 2, admin: 3 };
    if (roleHierarchy[user.role] < roleHierarchy[minRole]) {
      return { error: '权限不足' };
    }

    // 返回用户信息，隐藏敏感字段
    const userInfo = {
      id: user._id.toString(),
      username: user.username,
      role: user.role,
    };

    return { user: userInfo };
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return { error: '身份令牌无效' };
    } else if (error.name === 'TokenExpiredError') {
      return { error: '身份令牌已过期' };
    }
    console.error('身份验证错误:', error);
    return { error: '身份验证失败' };
  }
}