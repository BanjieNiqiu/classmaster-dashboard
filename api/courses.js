// api/courses.js
const { getDatabase, authenticate } = require('./utils');

module.exports = async (req, res) => {
  const db = await getDatabase();
  const coursesCollection = db.collection('courses');
  const usersCollection = db.collection('users'); // 用于验证用户权限

  if (req.method === 'GET') {
    // --- 获取课程情报列表 ---
    try {
      const { courseName, type } = req.query;
      let filter = {};

      if (courseName) filter.courseName = new RegExp(courseName, 'i'); // i 忽略大小写
      if (type) filter.type = type;

      const courses = await coursesCollection.find(filter).sort({ createdAt: -1 }).toArray();

      // 为安全起见，返回时不包含发布者的密码等敏感信息
      const safeCourses = courses.map(item => {
        const { author: rawAuthor, ...safeItem } = item;
        if (rawAuthor && typeof rawAuthor === 'object') {
            const { password, ...safeAuthor } = rawAuthor;
            safeItem.author = safeAuthor;
        }
        return safeItem;
      });

      res.status(200).json({ data: safeCourses });
    } catch (error) {
      console.error('获取课程情报失败:', error);
      res.status(500).json({ error: '服务器内部错误' });
    }
  } else if (req.method === 'POST') {
    // --- 创建课程情报 (需要认证) ---
    const authResult = await authenticate(req, 'student');
    if (authResult.error) {
      return res.status(401).json({ error: authResult.error });
    }

    try {
      const { courseName, title, content, type, attachments = [] } = req.body;
      const user = authResult.user;

      if (!courseName || !title || !content) {
        return res.status(400).json({ error: '课程名称、标题和内容不能为空' });
      }

      // 获取发布者完整信息用于存储
      const authorInfo = await usersCollection.findOne({ _id: require('mongodb').ObjectId(user.id) }, { projection: { password: 0 } }); // 排除密码

      const newCourse = {
        courseName,
        title,
        content,
        type, // e.g., 'announcement', 'assignment', 'exam', 'material'
        attachments, // Array of attachment objects
        author: authorInfo,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await coursesCollection.insertOne(newCourse);
      res.status(201).json({
        message: '课程情报发布成功',
        id: result.insertedId.toString(),
      });
    } catch (error) {
      console.error('发布课程情报失败:', error);
      res.status(500).json({ error: '服务器内部错误' });
    }
  } else if (req.method === 'PUT') {
    // --- 更新课程情报 (需要认证为发布者或更高权限) ---
    const authResult = await authenticate(req, 'student');
    if (authResult.error) {
      return res.status(401).json({ error: authResult.error });
    }
    const user = authResult.user;

    try {
      const { id, ...updateData } = req.body;
      if (!id) {
        return res.status(400).json({ error: '情报ID不能为空' });
      }

      const courseId = require('mongodb').ObjectId(id);
      const course = await coursesCollection.findOne({ _id: courseId });

      if (!course) {
        return res.status(404).json({ error: '课程情报不存在' });
      }

      // 权限检查：必须是作者或管理员
      const isAuthor = course.author && course.author.id === user.id;
      const isAdmin = user.role === 'admin';
      if (!isAuthor && !isAdmin) {
        return res.status(403).json({ error: '权限不足，无法修改此情报' });
      }

      const updateFields = { ...updateData, updatedAt: new Date() };
      // Prevent updating author and createdAt
      delete updateFields.author;
      delete updateFields.createdAt;

      await coursesCollection.updateOne({ _id: courseId }, { $set: updateFields });
      res.status(200).json({ message: '课程情报更新成功' });
    } catch (error) {
      console.error('更新课程情报失败:', error);
      res.status(500).json({ error: '服务器内部错误' });
    }
  } else if (req.method === 'DELETE') {
    // --- 删除课程情报 (需要认证为发布者或更高权限) ---
    const authResult = await authenticate(req, 'student');
    if (authResult.error) {
      return res.status(401).json({ error: authResult.error });
    }
    const user = authResult.user;

    try {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ error: '情报ID不能为空' });
      }

      const courseId = require('mongodb').ObjectId(id);
      const course = await coursesCollection.findOne({ _id: courseId });

      if (!course) {
        return res.status(404).json({ error: '课程情报不存在' });
      }

      // 权限检查：必须是作者或管理员
      const isAuthor = course.author && course.author.id === user.id;
      const isAdmin = user.role === 'admin';
      if (!isAuthor && !isAdmin) {
        return res.status(403).json({ error: '权限不足，无法删除此情报' });
      }

      await coursesCollection.deleteOne({ _id: courseId });
      res.status(200).json({ message: '课程情报删除成功' });
    } catch (error) {
      console.error('删除课程情报失败:', error);
      res.status(500).json({ error: '服务器内部错误' });
    }
  } else {
    res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
};