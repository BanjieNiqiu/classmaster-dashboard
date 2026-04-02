import { ObjectId } from 'mongodb';
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
  const coursesCollection = db.collection('courses');
  const usersCollection = db.collection('users');

  const method = event.httpMethod;
  const path = event.path || '';

  // GET /api/courses
  if (method === 'GET' && path === '/api/courses') {
    try {
      const { courseName, type } = event.queryStringParameters || {};
      const filter = {};
      if (courseName) filter.courseName = new RegExp(courseName, 'i');
      if (type) filter.type = type;

      const courses = await coursesCollection.find(filter).sort({ createdAt: -1 }).toArray();
      const safeCourses = courses.map(item => {
        const { author: rawAuthor, ...safeItem } = item;
        if (rawAuthor && typeof rawAuthor === 'object') {
          const { password: _pw, ...safeAuthor } = rawAuthor;
          safeItem.author = safeAuthor;
        }
        return safeItem;
      });

      return json(200, { data: safeCourses });
    } catch (error) {
      console.error('获取课程情报失败:', error);
      return json(500, { error: '服务器内部错误' });
    }
  }

  // POST /api/courses
  if (method === 'POST' && path === '/api/courses') {
    const authResult = await authenticate(event, 'student');
    if (authResult.error) return json(401, { error: authResult.error });

    try {
      const { courseName, title, content, type, attachments = [] } = getBody(event);
      if (!courseName || !title || !content) return json(400, { error: '课程名称、标题和内容不能为空' });

      const authorInfo = await usersCollection.findOne(
        { _id: new ObjectId(authResult.user.id) },
        { projection: { password: 0 } }
      );

      const newCourse = {
        courseName,
        title,
        content,
        type,
        attachments,
        author: authorInfo ? { id: authResult.user.id, username: authorInfo.username, role: authorInfo.role } : authResult.user,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await coursesCollection.insertOne(newCourse);
      return json(201, { message: '课程情报发布成功', id: result.insertedId.toString() });
    } catch (error) {
      console.error('发布课程情报失败:', error);
      return json(500, { error: '服务器内部错误' });
    }
  }

  // PUT /api/courses  (body: { id, ... })
  if (method === 'PUT' && path === '/api/courses') {
    const authResult = await authenticate(event, 'student');
    if (authResult.error) return json(401, { error: authResult.error });

    try {
      const { id, ...updateData } = getBody(event);
      if (!id) return json(400, { error: '情报ID不能为空' });

      const courseId = new ObjectId(id);
      const course = await coursesCollection.findOne({ _id: courseId });
      if (!course) return json(404, { error: '课程情报不存在' });

      const isAuthor = course.author && course.author.id === authResult.user.id;
      const isAdmin = authResult.user.role === 'admin';
      if (!isAuthor && !isAdmin) return json(403, { error: '权限不足，无法修改此情报' });

      const updateFields = { ...updateData, updatedAt: new Date() };
      delete updateFields.author;
      delete updateFields.createdAt;

      await coursesCollection.updateOne({ _id: courseId }, { $set: updateFields });
      return json(200, { message: '课程情报更新成功' });
    } catch (error) {
      console.error('更新课程情报失败:', error);
      return json(500, { error: '服务器内部错误' });
    }
  }

  // DELETE /api/courses (body: { id })
  if (method === 'DELETE' && path === '/api/courses') {
    const authResult = await authenticate(event, 'student');
    if (authResult.error) return json(401, { error: authResult.error });

    try {
      const { id } = getBody(event);
      if (!id) return json(400, { error: '情报ID不能为空' });

      const courseId = new ObjectId(id);
      const course = await coursesCollection.findOne({ _id: courseId });
      if (!course) return json(404, { error: '课程情报不存在' });

      const isAuthor = course.author && course.author.id === authResult.user.id;
      const isAdmin = authResult.user.role === 'admin';
      if (!isAuthor && !isAdmin) return json(403, { error: '权限不足，无法删除此情报' });

      await coursesCollection.deleteOne({ _id: courseId });
      return json(200, { message: '课程情报删除成功' });
    } catch (error) {
      console.error('删除课程情报失败:', error);
      return json(500, { error: '服务器内部错误' });
    }
  }

  return json(404, { error: '接口不存在' });
}