/**
 * api/llm.js - LLM智能问答助手 Serverless Function
 * 实现基于检索增强生成（RAG）的智能问答系统，集成语义搜索、流式回复和对话历史管理
 * 部署于 Vercel Serverless Functions (/api/llm)
 */

import { Configuration, OpenAIApi } from 'openai';
import { v4 as uuidv4 } from 'uuid';

// 模拟数据库连接（实际应替换为 MongoDB/Supabase 等）
const db = {
  course_intel: [],
  conversations: [],
  users: []
};

// CORS 头部配置
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
 * 问题分类识别
 * @param {string} question - 用户提问
 * @returns {string} 问题类型
 */
function classifyQuestion(question) {
  const lowerQuestion = question.toLowerCase();
  if (lowerQuestion.includes('作业') || lowerQuestion.includes('assignment')) {
    return 'coursework';
  } else if (lowerQuestion.includes('考试') || lowerQuestion.includes('exam') || lowerQuestion.includes('测验')) {
    return 'exam';
  } else if (lowerQuestion.includes('资料') || lowerQuestion.includes('课件') || lowerQuestion.includes('笔记')) {
    return 'materials';
  } else if (lowerQuestion.includes('任务') || lowerQuestion.includes('收集')) {
    return 'tasks';
  } else if (lowerQuestion.includes('借用') || lowerQuestion.includes('物资') || lowerQuestion.includes('相机')) {
    return 'items';
  } else {
    return 'general';
  }
}

/**
 * 生成文本嵌入向量（模拟）
 * @param {string} text - 输入文本
 * @returns {Promise<Array<number>>} 向量数组
 */
async function generateEmbedding(text) {
  // 实际应用中应调用真正的LLM嵌入API
  // 此处返回一个随机向量用于演示
  const embeddingSize = 1536; // 假设使用text-embedding-ada-002
  return Array(embeddingSize).fill().map(() => Math.random() * 2 - 1);
}

/**
 * 计算余弦相似度
 * @param {Array<number>} vecA - 向量A
 * @param {Array<number>} vecB - 向量B
 * @returns {number} 相似度分数
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 语义相似度搜索
 * @param {Array<number>} queryEmbedding - 查询向量
 * @param {Array<Object>} items - 搜索项数组
 * @param {string} embeddingField - 嵌入字段名
 * @param {number} limit - 返回结果数量
 * @returns {Array<Object>} 排序后的结果
 */
async function semanticSearch(queryEmbedding, items, embeddingField = 'llm_embedding', limit = 5) {
  const results = items.map(item => {
    if (!item[embeddingField] || item[embeddingField].length !== queryEmbedding.length) {
      return { ...item, similarity: 0 };
    }
    const similarity = cosineSimilarity(queryEmbedding, item[embeddingField]);
    return { ...item, similarity };
  }).filter(result => result.similarity > 0.7); // 相似度阈值

  // 综合排序：相关性、时效性、可信度
  return results.sort((a, b) => {
    // 主要按相似度排序
    if (b.similarity !== a.similarity) {
      return b.similarity - a.similarity;
    }
    // 相似度相同时，按创建时间降序（最新优先）
    const timeDiff = new Date(b.created_at) - new Date(a.created_at);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    // 时间相同时，按verified状态和upvotes排序
    if (b.verified !== a.verified) {
      return b.verified ? 1 : -1;
    }
    return (b.upvotes || 0) - (a.upvotes || 0);
  }).slice(0, limit);
}

/**
 * 初始化OpenAI客户端
 * @returns {OpenAIApi} OpenAI API实例
 */
function getOpenAIClient() {
  const configuration = new Configuration({
    apiKey: process.env.LLM_API_KEY,
    basePath: process.env.OPENAI_API_BASE_PATH // 支持自定义端点
  });
  return new OpenAIApi(configuration);
}

/**
 * 调用LLM API生成回答（支持流式）
 * @param {string} prompt - 提示词
 * @param {Object} options - 请求参数
 * @param {Function} onChunk - 流式回调函数
 * @returns {Promise<string>} 完整回答
 */
async function callLLM(prompt, options = {}, onChunk = null) {
  const openai = getOpenAIClient();
  const params = {
    model: process.env.LLM_MODEL || 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: prompt }],
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
    max_tokens: parseInt(process.env.LLM_MAX_TOKENS || '1000'),
    top_p: parseFloat(process.env.LLM_TOP_P || '1.0'),
    stream: !!onChunk,
    ...options
  };

  try {
    if (params.stream) {
      const response = await openai.createChatCompletion(params);
      let fullResponse = '';
      for await (const chunk of response.data) {
        const content = chunk.choices[0]?.delta?.content || '';
        fullResponse += content;
        if (onChunk && content) {
          onChunk(content);
        }
      }
      return fullResponse;
    } else {
      const response = await openai.createChatCompletion(params);
      return response.data.choices[0].message.content;
    }
  } catch (error) {
    console.error('LLM API调用失败:', error);
    // 降级处理：尝试其他模型或返回本地知识库回答
    if (params.model !== 'gpt-3.5-turbo') {
      // 重试基础模型
      params.model = 'gpt-3.5-turbo';
      delete params.stream;
      try {
        const response = await openai.createChatCompletion(params);
        return response.data.choices[0].message.content;
      } catch (retryError) {
        console.error('降级模型调用也失败:', retryError);
      }
    }
    throw error;
  }
}

/**
 * 结构化信息提取
 * @param {string} answer - AI回答
 * @returns {Object} 提取的结构化数据
 */
function extractStructuredInfo(answer) {
  const info = {
    homework: [],
    exams: [],
    deadlines: [],
    links: []
  };

  // 提取链接
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  let match;
  while ((match = urlRegex.exec(answer)) !== null) {
    info.links.push(match[1]);
  }

  // 提取截止日期
  const dateRegex = /(\d{4})[年\-\/\.](\d{1,2})[月\-\/\.](\d{1,2})日?/g;
  while ((match = dateRegex.exec(answer)) !== null) {
    info.deadlines.push(new Date(match[0]).toISOString());
  }

  return info;
}

/**
 * POST /api/llm/ask - 智能问答接口，接收自然语言问题，返回AI回答
 */
export async function askQuestion(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  // 速率限制检查（简化实现）
  const now = Date.now();
  const oneHourAgo = now - 3600000;
  const recentRequests = db.conversations.filter(c => 
    c.user_id === authResult.user.user_id && 
    c.created_at > oneHourAgo &&
    c.type === 'ask_request'
  );
  
  if (recentRequests.length >= 60) { // 1分钟最多60次请求
    return createError('请求过于频繁，请稍后再试', 429);
  }

  try {
    const { question, session_id } = JSON.parse(event.body);

    if (!question || question.trim().length === 0) {
      return createError('问题不能为空');
    }

    if (question.length > 1000) {
      return createError('问题过长，请精简后重新提问');
    }

    // 问题分类
    const questionType = classifyQuestion(question);

    // 生成查询嵌入
    const queryEmbedding = await generateEmbedding(question);

    // 语义搜索相关情报
    let searchResults = [];
    if (questionType === 'coursework' || questionType === 'exam' || questionType === 'materials') {
      // 从course_intel中搜索
      searchResults = await semanticSearch(queryEmbedding, db.course_intel, 'llm_embedding', 5);
    }

    // 构建RAG提示词
    let context = '';
    if (searchResults.length > 0) {
      context = '参考以下相关信息来回答问题：\n\n';
      searchResults.forEach((item, index) => {
        context += `【${index + 1}】${item.title}\n`;
        context += `内容：${item.content.substring(0, 300)}...\n`;
        context += `截止时间：${item.deadline || '无'} | 来源：${item.source_url}\n\n`;
      });
    } else {
      context = '未找到直接相关的参考资料。请根据通用知识回答。\n';
    }

    const prompt = `${context}
你是一个班级事务助手，请以友好、简洁的方式回答问题。
如果提供了参考资料，请优先参考；如果没有，请给出一般性建议。
请确保回答准确，避免猜测。

问题：${question}

回答：`;

    // 创建会话记录
    const conversationId = session_id || uuidv4();
    const conversationEntry = {
      id: uuidv4(),
      conversation_id: conversationId,
      type: 'question',
      content: question,
      metadata: {
        question_type: questionType,
        search_results_count: searchResults.length
      },
      user_id: authResult.user.user_id,
      created_at: new Date().toISOString()
    };
    db.conversations.push(conversationEntry);

    // 准备流式响应
    if (event.headers.accept && event.headers.accept.includes('text/event-stream')) {
      // 流式响应
      const chunks = [];
      const response = await callLLM(prompt, {}, (chunk) => {
        chunks.push(chunk);
      });

      // 存储完整回答
      const answerEntry = {
        id: uuidv4(),
        conversation_id: conversationId,
        type: 'answer',
        content: response,
        metadata: {
          tokens_used: response.length,
          structured_info: extractStructuredInfo(response)
        },
        created_at: new Date().toISOString()
      };
      db.conversations.push(answerEntry);

      // 构建SSE响应
      const sseChunks = chunks.map(chunk => `data: ${JSON.stringify({ content: chunk })}\n\n`);
      sseChunks.push('data: [DONE]\n\n');

      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        },
        body: sseChunks.join('')
      };
    } else {
      // 普通响应
      const response = await callLLM(prompt);

      // 存储回答
      const answerEntry = {
        id: uuidv4(),
        conversation_id: conversationId,
        type: 'answer',
        content: response,
        metadata: {
          tokens_used: response.length,
          structured_info: extractStructuredInfo(response)
        },
        created_at: new Date().toISOString()
      };
      db.conversations.push(answerEntry);

      return createSuccess({
        answer: response,
        question_type: questionType,
        references: searchResults.map(r => ({
          title: r.title,
          source_url: r.source_url,
          similarity: r.similarity
        })),
        conversation_id: conversationId
      });
    }
  } catch (error) {
    console.error('问答接口错误:', error);
    return createError('抱歉，服务暂时不可用，请稍后再试', 500);
  }
}

/**
 * POST /api/llm/conversation - 创建新的对话会话
 */
export async function createConversation(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { title = '新对话' } = JSON.parse(event.body || '{}');

    const conversation = {
      id: uuidv4(),
      title,
      user_id: authResult.user.user_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'active'
    };

    db.conversations.push({
      id: uuidv4(),
      conversation_id: conversation.id,
      type: 'conversation_start',
      content: `对话开始：${title}`,
      user_id: authResult.user.user_id,
      created_at: new Date().toISOString()
    });

    return createSuccess(conversation);
  } catch (error) {
    console.error('创建对话失败:', error);
    return createError('创建对话失败');
  }
}

/**
 * GET /api/llm/conversation/{session_id} - 获取对话历史记录
 */
export async function getConversation(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { pathParameters } = event;
    if (!pathParameters || !pathParameters.session_id) {
      return createError('缺少会话ID');
    }

    const sessionId = pathParameters.session_id;
    
    // 检查会话是否存在且属于当前用户
    const sessionExists = db.conversations.some(c => 
      c.conversation_id === sessionId && c.user_id === authResult.user.user_id
    );

    if (!sessionExists) {
      return createError('会话不存在或无权访问', 404);
    }

    const history = db.conversations
      .filter(c => c.conversation_id === sessionId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    return createSuccess({
      conversation_id: sessionId,
      history
    });
  } catch (error) {
    console.error('获取对话历史失败:', error);
    return createError('获取对话历史失败');
  }
}

/**
 * DELETE /api/llm/conversation/{session_id} - 删除对话会话
 */
export async function deleteConversation(event) {
  if (event.httpMethod !== 'DELETE') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  try {
    const { pathParameters } = event;
    if (!pathParameters || !pathParameters.session_id) {
      return createError('缺少会话ID');
    }

    const sessionId = pathParameters.session_id;
    
    // 检查会话是否属于当前用户
    const sessionMessages = db.conversations.filter(c => 
      c.conversation_id === sessionId && c.user_id === authResult.user.user_id
    );

    if (sessionMessages.length === 0) {
      return createError('会话不存在或无权删除', 404);
    }

    // 删除会话所有消息
    db.conversations = db.conversations.filter(c => 
      !(c.conversation_id === sessionId && c.user_id === authResult.user.user_id)
    );

    return createSuccess({
      message: '会话已成功删除',
      deleted_count: sessionMessages.length
    });
  } catch (error) {
    console.error('删除对话失败:', error);
    return createError('删除对话失败');
  }
}

/**
 * GET /api/llm/stats - 获取LLM使用统计
 */
export async function getStats(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders };

  const authResult = await authenticate(event);
  if (authResult.error) return authResult;

  // 只有admin和monitor可以查看统计
  if (!['admin', 'monitor'].includes(authResult.user.role)) {
    return createError('权限不足', 403);
  }

  try {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 请求总数
    const totalRequests = db.conversations.filter(c => 
      c.type === 'ask_request' && 
      new Date(c.created_at) >= oneWeekAgo
    ).length;

    // 问答类型分布
    const typeCounts = {};
    db.conversations
      .filter(c => c.type === 'question' && new Date(c.created_at) >= oneWeekAgo)
      .forEach(c => {
        const qType = c.metadata?.question_type || 'general';
        typeCounts[qType] = (typeCounts[qType] || 0) + 1;
      });

    // 高频问题
    const questions = db.conversations
      .filter(c => c.type === 'question')
      .map(c => c.content.toLowerCase().trim())
      .reduce((acc, q) => {
        acc[q] = (acc[q] || 0) + 1;
        return acc;
      }, {});
    
    const topQuestions = Object.entries(questions)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([q, count]) => ({ question: q, count }));

    return createSuccess({
      period: 'last_7_days',
      total_requests: totalRequests,
      question_types: typeCounts,
      top_questions: topQuestions,
      active_users: [...new Set(db.conversations.filter(c => 
        new Date(c.created_at) >= oneWeekAgo
      ).map(c => c.user_id))].length
    });
  } catch (error) {
    console.error('获取统计失败:', error);
    return createError('获取统计失败');
  }
}

/**
 * 主处理器函数
 */
export default async function handler(event, context) {
  // 处理预检请求
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders
    };
  }

  // 解析路径
  const path = event.path || '';
  const pathParts = path.split('/').filter(p => p);

  try {
    if (pathParts[0] === 'llm') {
      if (pathParts[1] === 'ask' && event.httpMethod === 'POST') {
        return await askQuestion(event);
      } else if (pathParts[1] === 'conversation') {
        if (event.httpMethod === 'POST') {
          return await createConversation(event);
        } else if (event.httpMethod === 'GET' && pathParts[2]) {
          event.pathParameters = { session_id: pathParts[2] };
          return await getConversation(event);
        } else if (event.httpMethod === 'DELETE' && pathParts[2]) {
          event.pathParameters = { session_id: pathParts[2] };
          return await deleteConversation(event);
        }
      } else if (pathParts[1] === 'stats' && event.httpMethod === 'GET') {
        return await getStats(event);
      }
    }

    // 未找到路由
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'API not found' })
    };
  } catch (error) {
    console.error('Handler error:', error);
    return createError('Internal server error', 500);
  }
}