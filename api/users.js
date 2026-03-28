// api/users.js
const { hashPassword, verifyPassword } = require('./auth');
const { getDatabase, authenticate } = require('./utils');

module.exports = async (req, res) => {
  const db = await getDatabase();
  const usersCollection = db.collection('users');

  if (req.method === 'POST') {
    // --- 用户注册 ---
    if (req.url === '/api/users/register') {
      try {
        const { username, password, role = 'student' } = req.body;

        if (!username || !password) {
          return res.status(400).json({ error: '用户名和密码不能为空' });
        }

        // 检查用户是否已存在
        const existingUser = await usersCollection.findOne({ username });
        if (existingUser) {
          return res.status(409).json({ error: '用户名已存在' });
        }

        // 对密码进行哈希
        const hashedPassword = await hashPassword(password);

        const newUser = {
          username,
          password: hashedPassword,
          role, // 'student', 'monitor', 'admin'
          createdAt: new Date(),
        };

        const result = await usersCollection.insertOne(newUser);
        res.status(201).json({
          message: '用户注册成功',
          userId: result.insertedId.toString(),
        });
      } catch (error) {
        console.error('用户注册失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
      }
    }
    // --- 用户登录 ---
    else if (req.url === '/api/users/login') {
      try {
        const { username, password } = req.body;

        if (!username || !password) {
          return res.status(400).json({ error: '用户名和密码不能为空' });
        }

        const user = await usersCollection.findOne({ username });
        if (!user) {
          return res.status(401).json({ error: '用户名或密码错误' });
        }

        const isPasswordValid = await verifyPassword(password, user.password);
        if (!isPasswordValid) {
          return res.status(401).json({ error: '用户名或密码错误' });
        }

        // 生成JWT令牌
        const jwt = require('jsonwebtoken');
        const jwtSecret = process.env.JWT_SECRET;
        const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

        if (!jwtSecret) {
            return res.status(500).json({ error: '服务器配置错误 (JWT_SECRET)' });
        }

        const token = jwt.sign(
          { userId: user._id.toString(), username: user.username },
          jwtSecret,
          { expiresIn }
        );

        // 返回用户信息和令牌，隐藏密码
        const { password: _, ...userInfo } = user;
        res.status(200).json({
          message: '登录成功',
          token,
          user: {
            id: user._id.toString(),
            username: userInfo.username,
            role: userInfo.role,
          },
        });
      } catch (error) {
        console.error('用户登录失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
      }
    } else {
      res.status(404).json({ error: '接口不存在' });
    }
  } else if (req.method === 'GET') {
    // --- 获取用户信息 (需要认证) ---
    const authResult = await authenticate(req, 'student');
    if (authResult.error) {
      return res.status(401).json({ error: authResult.error });
    }

    try {
      const user = authResult.user;
      // 根据ID从数据库获取完整信息以确保最新
      const fullUser = await usersCollection.findOne({ _id: require('mongodb').ObjectId(user.id) });
      if (!fullUser) {
        return res.status(404).json({ error: '用户不存在' });
      }
      const { password: _, ...safeUser } = fullUser; // 隐藏密码
      res.status(200).json({ user: safeUser });
    } catch (error) {
      console.error('获取用户信息失败:', error);
      res.status(500).json({ error: '服务器内部错误' });
    }
  } else {
    res.setHeader('Allow', ['POST', 'GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
};