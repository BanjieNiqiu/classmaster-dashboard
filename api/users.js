import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { hashPassword, verifyPassword } from './auth.js';
import { authenticate, getDatabase } from './utils.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
};

const json = (statusCode, data, extraHeaders = {}) => ({
  statusCode,
  headers: { ...corsHeaders, ...extraHeaders },
  body: JSON.stringify(data)
});

function getBody(event) {
  if (event?.parsedBody && typeof event.parsedBody === 'object') return event.parsedBody;
  if (!event?.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

export default async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders };

  const db = await getDatabase();
  const usersCollection = db.collection('users');

  const method = event.httpMethod;
  const path = event.path || '';

  // POST /api/users/register
  if (method === 'POST' && path === '/api/users/register') {
    try {
      const { username, password, role = 'student' } = getBody(event);
      if (!username || !password) return json(400, { error: '用户名和密码不能为空' });

      const existingUser = await usersCollection.findOne({ username });
      if (existingUser) return json(409, { error: '用户名已存在' });

      const hashedPassword = await hashPassword(password);
      const newUser = {
        username,
        password: hashedPassword,
        role,
        createdAt: new Date()
      };

      const result = await usersCollection.insertOne(newUser);
      return json(201, { message: '用户注册成功', userId: result.insertedId.toString() });
    } catch (error) {
      console.error('用户注册失败:', error);
      return json(500, { error: '服务器内部错误' });
    }
  }

  // POST /api/users/login
  if (method === 'POST' && path === '/api/users/login') {
    try {
      const { username, password } = getBody(event);
      if (!username || !password) return json(400, { error: '用户名和密码不能为空' });

      const user = await usersCollection.findOne({ username });
      if (!user) return json(401, { error: '用户名或密码错误' });

      const isPasswordValid = await verifyPassword(password, user.password);
      if (!isPasswordValid) return json(401, { error: '用户名或密码错误' });

      const jwtSecret = process.env.JWT_SECRET;
      const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
      if (!jwtSecret) return json(500, { error: '服务器配置错误 (JWT_SECRET)' });

      const token = jwt.sign(
        { userId: user._id.toString(), username: user.username, role: user.role },
        jwtSecret,
        { expiresIn }
      );

      const { password: _pw, ...userInfo } = user;
      return json(200, {
        message: '登录成功',
        token,
        user: { id: user._id.toString(), username: userInfo.username, role: userInfo.role }
      });
    } catch (error) {
      console.error('用户登录失败:', error);
      return json(500, { error: '服务器内部错误' });
    }
  }

  // GET /api/users/me
  if (method === 'GET' && (path === '/api/users' || path === '/api/users/me')) {
    const authResult = await authenticate(event, 'student');
    if (authResult.error) return json(401, { error: authResult.error });
    try {
      const fullUser = await usersCollection.findOne({ _id: new ObjectId(authResult.user.id) });
      if (!fullUser) return json(404, { error: '用户不存在' });
      const { password: _pw, ...safeUser } = fullUser;
      return json(200, { user: safeUser });
    } catch (error) {
      console.error('获取用户信息失败:', error);
      return json(500, { error: '服务器内部错误' });
    }
  }

  // Admin CRUD (minimal)
  const idMatch = path.match(/^\/api\/users\/([^/]+)$/);
  if (idMatch) {
    const userId = idMatch[1];
    const authResult = await authenticate(event, 'admin');
    if (authResult.error) return json(401, { error: authResult.error });

    if (method === 'GET') {
      const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
      if (!user) return json(404, { error: '用户不存在' });
      const { password: _pw, ...safeUser } = user;
      return json(200, { user: safeUser });
    }

    if (method === 'PUT') {
      const body = getBody(event);
      const update = {};
      if (body.username) update.username = body.username;
      if (body.role) update.role = body.role;
      if (body.password) update.password = await hashPassword(body.password);
      update.updatedAt = new Date();

      const result = await usersCollection.updateOne({ _id: new ObjectId(userId) }, { $set: update });
      if (result.matchedCount === 0) return json(404, { error: '用户不存在' });
      return json(200, { message: '用户更新成功' });
    }

    if (method === 'DELETE') {
      const result = await usersCollection.deleteOne({ _id: new ObjectId(userId) });
      if (result.deletedCount === 0) return json(404, { error: '用户不存在' });
      return json(200, { message: '用户删除成功' });
    }
  }

  if (method === 'GET' && path === '/api/users/list') {
    const authResult = await authenticate(event, 'admin');
    if (authResult.error) return json(401, { error: authResult.error });
    const users = await usersCollection
      .find({}, { projection: { password: 0 } })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    return json(200, { users });
  }

  return json(404, { error: '接口不存在' });
}