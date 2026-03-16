/**
 * script.js - 班级班务管理系统交互逻辑主文件（含身份认证与权限控制）
 * 实现四大功能模块的前端交互：信息收集、物资共享、课作业查询、文档资源
 * 新增：基于 localStorage 的身份认证系统和细粒度权限控制系统
 * 所有数据持久化存储于 localStorage，无需后端支持
 */

// ================== 常量定义 ==================

const STORAGE_KEYS = {
  INFO_FORMS: 'classmaster_info_forms',           // 班委创建的信息收集表单列表
  ITEMS: 'classmaster_shared_items',              // 共享物资列表
  COURSES: 'classmaster_courses',                 // 课程列表
  COURSE_INTELLIGENCE: 'classmaster_course_intel', // 课程情报（作业/通知）
  DOCUMENTS: 'classmaster_documents',             // 文档资源元数据
  AUTH: 'classmaster_auth'                        // 认证状态存储键名
};

// 预定义特权账号列表
const PRIVILEGED_ACCOUNTS = [
  { username: "admin", password: "admin123", level: "admin" },
  { username: "monitor", password: "class2026", level: "moderator" }
];

// 默认LLM响应（用于模拟）
const DEFAULT_LLM_RESPONSE = `
根据近期课程情报分析，本周重点如下：
1. 高数作业第5章习题需在周五前提交（来源：2026-03-08 发布的情报）
2. 英语口语展示分组名单已公布（来源：2026-03-09 上传的文档）
3. 物理实验报告模板可在【文档资源】中下载（来源：2026-03-07 发布的情报）

> 注意：以上为模拟AI总结内容，实际系统应接入LLM API。
`;

// ================== 工具函数 ==================

/**
 * 从 localStorage 安全读取数据并解析 JSON
 * @param {string} key - 存储键名
 * @param {*} defaultValue - 默认值（若无数据时返回）
 * @returns {any} 解析后的数据或默认值
 */
function getData(key, defaultValue = []) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : defaultValue;
  } catch (e) {
    console.warn(`读取 localStorage 数据失败 (${key}):`, e);
    showToast('数据读取异常，已使用默认值', 'error');
    return defaultValue;
  }
}

/**
 * 将数据安全写入 localStorage
 * @param {string} key - 存储键名
 * @param {any} data - 要存储的数据
 * @returns {boolean} 是否保存成功
 */
function saveData(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error(`保存数据到 localStorage 失败 (${key}):`, e);
    showToast('存储空间已满或浏览器隐私设置限制', 'error');
    return false;
  }
}

/**
 * 显示操作提示 Toast
 * @param {string} message - 提示消息
 * @param {'success'|'error'|'info'} type - 提示类型
 */
function showToast(message, type = 'info') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'fixed top-4 right-4 max-w-xs bg-white border-l-4 px-4 py-3 rounded shadow-lg z-50 no-scrollbar transition-all duration-300 ease-out opacity-0 pointer-events-none toast-exit';
    document.body.appendChild(toast);
  }

  // 设置样式
  toast.className = toast.className.replace(/bg-\w+-\d+/g, '').replace(/border-\w+-\d+/g, '');
  if (type === 'success') {
    toast.classList.add('bg-emerald-50', 'border-emerald-500');
  } else if (type === 'error') {
    toast.classList.add('bg-red-50', 'border-red-500');
  } else {
    toast.classList.add('bg-blue-50', 'border-blue-500');
  }

  // 更新内容
  toast.innerHTML = `
    <div class="flex items-start">
      <div class="text-sm text-gray-700">${message}</div>
      <button onclick="this.parentElement.parentElement.remove()" class="ml-3 text-gray-400 hover:text-gray-600">&times;</button>
    </div>
  `;

  // 显示动画
  setTimeout(() => {
    toast.classList.remove('opacity-0', 'toast-exit');
    toast.classList.add('opacity-100', 'toast-enter');
  }, 10);

  // 自动隐藏
  setTimeout(() => {
    toast.classList.remove('toast-enter');
    toast.classList.add('toast-exit');
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 300);
  }, 3000);
}

/**
 * 生成唯一ID（时间戳 + 随机数）
 * @returns {string}
 */
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * HTML实体转义，防止XSS
 * @param {string} str 
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 格式化日期显示
 * @param {string} isoDate - ISO格式日期字符串
 * @returns {string}
 */
function formatDate(isoDate) {
  try {
    return new Date(isoDate).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch (e) {
    return isoDate;
  }
}

// ================== 身份认证系统 ==================

/**
 * 处理用户登录验证
 */
function handleLogin() {
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  
  const username = (usernameInput.value || '').trim();
  const password = (passwordInput.value || '').trim();

  if (!username || !password) {
    showToast('请输入用户名和密码', 'error');
    return;
  }

  // 验证账号密码
  const account = PRIVILEGED_ACCOUNTS.find(acc => acc.username === username && acc.password === password);
  
  if (account) {
    // 登录成功，存储认证状态
    const authData = {
      username: account.username,
      level: account.level,
      loginTime: new Date().toISOString(),
      isLoggedIn: true
    };
    
    localStorage.setItem(STORAGE_KEYS.AUTH, JSON.stringify(authData));
    showToast(`欢迎回来，${account.username}！`, 'success');
    
    // 更新UI状态
    updateAuthUI(true, account.username);
  } else {
    showToast('用户名或密码错误', 'error');
  }
}

/**
 * 处理用户注销
 */
function handleLogout() {
  localStorage.removeItem(STORAGE_KEYS.AUTH);
  showToast('已安全登出', 'info');
  updateAuthUI(false);
}

/**
 * 检查当前用户是否已登录且为特权账号
 * @returns {boolean}
 */
function isAdmin() {
  try {
    const authStr = localStorage.getItem(STORAGE_KEYS.AUTH);
    if (!authStr) return false;
    
    const auth = JSON.parse(authStr);
    return auth && auth.isLoggedIn === true;
  } catch (e) {
    console.error('认证状态解析失败:', e);
    return false;
  }
}

/**
 * 检查当前用户是否有权限访问特定功能
 * @param {string} permission - 权限标识符
 * @returns {boolean}
 */
function checkPermission(permission) {
  if (!permission) return true;
  
  switch (permission) {
    case 'create_form':
    case 'upload_document':
    case 'delete_document':
      return isAdmin();
    case 'borrow_item':
    case 'view_courses':
    case 'submit_form':
      return true; // 所有用户均可
    default:
      return false;
  }
}

/**
 * 根据认证状态更新UI显示
 * @param {boolean} isLoggedIn - 是否已登录
 * @param {string} username - 用户名（可选）
 */
function updateAuthUI(isLoggedIn, username = '') {
  const loginContainer = document.getElementById('login-form-container');
  const adminPanel = document.getElementById('admin-panel');
  const userDisplayName = document.getElementById('user-display-name');

  if (isLoggedIn && loginContainer && adminPanel && userDisplayName) {
    loginContainer.classList.add('hidden');
    adminPanel.classList.remove('hidden');
    userDisplayName.textContent = username;
    
    // 初始化权限相关按钮状态
    initPermissionButtons();
  } else if (loginContainer && adminPanel) {
    loginContainer.classList.remove('hidden');
    adminPanel.classList.add('hidden');
  }
}

/**
 * 页面加载时检查认证状态并恢复
 */
function checkAuthOnLoad() {
  try {
    const authStr = localStorage.getItem(STORAGE_KEYS.AUTH);
    if (!authStr) {
      updateAuthUI(false);
      return;
    }

    const auth = JSON.parse(authStr);
    if (auth && auth.isLoggedIn === true) {
      // 可添加会话有效期检查（如7天内有效）
      const loginTime = new Date(auth.loginTime);
      const now = new Date();
      const diffDays = (now - loginTime) / (1000 * 60 * 60 * 24);
      
      if (diffDays <= 7) {
        updateAuthUI(true, auth.username);
      } else {
        // 会话过期
        handleLogout();
      }
    } else {
      updateAuthUI(false);
    }
  } catch (e) {
    console.error('自动登录检查失败:', e);
    updateAuthUI(false);
  }
}

// ================== 权限控制初始化 ==================

/**
 * 初始化需要权限控制的按钮状态
 */
function initPermissionButtons() {
  // 信息收集 - 新建收集按钮
  const createFormBtn = document.querySelector('#info .bg-indigo-600');
  if (createFormBtn) {
    createFormBtn.disabled = !checkPermission('create_form');
    createFormBtn.style.opacity = checkPermission('create_form') ? '1' : '0.6';
    createFormBtn.title = checkPermission('create_form') ? '' : '仅管理员可创建';
  }

  // 物资共享 - 上架物资按钮
  const addItemBtn = document.querySelector('#items .bg-green-600');
  if (addItemBtn) {
    // 根据需求，所有同学均可上架物资，因此始终启用
    addItemBtn.disabled = false;
    addItemBtn.style.opacity = '1';
  }

  // 文档资源 - 上传文档标签
  const uploadLabel = document.querySelector('#docs label[for="file-upload-input"]');
  if (uploadLabel) {
    const input = document.getElementById('file-upload-input');
    if (input) {
      input.disabled = !checkPermission('upload_document');
      uploadLabel.style.opacity = checkPermission('upload_document') ? '1' : '0.6';
      uploadLabel.title = checkPermission('upload_document') ? '' : '仅管理员可上传';
    }
  }

  // 动态为文档行添加删除按钮的权限控制将在 renderFiles 中处理
}

// ================== 信息收集模块 ==================

/**
 * 初始化信息收集模块
 */
function initInfoModule() {
  renderFormList();
  bindCreateFormEvents();
}

/**
 * 绑定创建表单相关事件
 */
function bindCreateFormEvents() {
  const createFormArea = document.getElementById('create-form-area');
  if (!createFormArea) return;

  // 切换创建表单区域显示
  window.toggleCreateForm = function() {
    if (!checkPermission('create_form')) {
      showToast('您没有权限创建表单', 'error');
      return;
    }
    createFormArea.classList.toggle('hidden');
  };

  // 保存新表单
  window.saveNewForm = function() {
    if (!checkPermission('create_form')) {
      showToast('您没有权限创建表单', 'error');
      return;
    }

    const title = document.getElementById('new-form-title').value?.trim();
    const questionsRaw = document.getElementById('new-form-questions').value;

    if (!title || !questionsRaw) {
      showToast('请填写完整信息', 'error');
      return;
    }

    const questions = questionsRaw.split('\n').filter(q => q.trim() !== '');
    if (questions.length === 0) {
      showToast('至少需要一个问题', 'error');
      return;
    }

    const forms = getData(STORAGE_KEYS.INFO_FORMS);
    const newForm = {
      id: generateId(),
      title,
      questions,
      responses: [],
      createdAt: new Date().toISOString()
    };

    forms.unshift(newForm);
    const success = saveData(STORAGE_KEYS.INFO_FORMS, forms);

    if (success) {
      document.getElementById('new-form-title').value = '';
      document.getElementById('new-form-questions').value = '';
      toggleCreateForm();
      renderFormList();
      showToast('表单创建成功！');
    }
  };
}

/**
 * 渲染信息收集表单列表
 */
function renderFormList() {
  const container = document.getElementById('forms-container');
  if (!container) return;

  const forms = getData(STORAGE_KEYS.INFO_FORMS);
  if (forms.length === 0) {
    container.innerHTML = '<p class="text-gray-500 text-center py-8">暂无活动表单</p>';
    return;
  }

  container.innerHTML = forms.map(form => `
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition">
      <div class="flex justify-between items-start mb-3">
        <h3 class="font-bold text-lg text-gray-800">${escapeHtml(form.title)}</h3>
        <span class="bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded-full">进行中</span>
      </div>
      <p class="text-sm text-gray-500 mb-4">包含 ${form.questions.length} 个问题</p>
      <button onclick="openFillForm('${form.id}')" class="w-full block text-center bg-indigo-50 text-indigo-600 py-2 rounded-lg font-medium hover:bg-indigo-100 transition">填写表单</button>
    </div>
  `).join('');
}

/**
 * 打开填写表单模态框
 * @param {string} formId 
 */
function openFillForm(formId) {
  const forms = getData(STORAGE_KEYS.INFO_FORMS);
  const form = forms.find(f => f.id === formId);
  if (!form) {
    showToast('表单不存在', 'error');
    return;
  }

  // 创建动态模态框
  const modalHtml = `
    <div id="fill-form-modal" class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center">
      <div class="relative p-6 border w-full max-w-lg shadow-lg rounded-xl bg-white m-4">
        <h3 class="text-xl font-bold text-gray-900 mb-4">${escapeHtml(form.title)}</h3>
        <form id="dynamic-fill-form" class="space-y-4">
          ${form.questions.map((q, idx) => `
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">${escapeHtml(q)}</label>
              <input type="text" name="q_${idx}" required class="w-full border border-gray-300 rounded p-2 focus:ring-indigo-500 focus:border-indigo-500">
            </div>
          `).join('')}
          <div class="flex justify-end gap-3 mt-6">
            <button type="button" onclick="closeFillFormModal()" class="px-4 py-2 border rounded text-gray-700">取消</button>
            <button type="submit" class="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">提交</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // 绑定提交事件
  document.getElementById('dynamic-fill-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const response = {};
    
    form.questions.forEach((q, idx) => {
      response[q] = formData.get(`q_${idx}`) || '';
    });

    // 保存提交记录
    const submissions = getData(`${STORAGE_KEYS.INFO_SUBMISSIONS}_${formId}`, []);
    submissions.push({
      id: generateId(),
      response,
      submittedAt: new Date().toISOString(),
      submitter: '匿名同学' // 可扩展为实名
    });

    saveData(`${STORAGE_KEYS.INFO_SUBMISSIONS}_${formId}`, submissions);
    
    // 更新表单状态（可选）
    closeFillFormModal();
    showToast('提交成功！');
  });
}

/**
 * 关闭填写表单模态框
 */
function closeFillFormModal() {
  const modal = document.getElementById('fill-form-modal');
  if (modal) modal.remove();
}

// ================== 物资共享模块 ==================

/**
 * 初始化物资共享模块
 */
function initItemsModule() {
  renderItems();
  bindItemEvents();
}

/**
 * 绑定物资相关事件
 */
function bindItemEvents() {
  // 打开/关闭上架物资模态框
  window.openAddItemModal = function() {
    document.getElementById('add-item-modal').classList.remove('hidden');
  };

  window.closeAddItemModal = function() {
    document.getElementById('add-item-modal').classList.add('hidden');
    document.getElementById('item-name').value = '';
    document.getElementById('item-desc').value = '';
  };

  // 添加物资
  window.addItem = function() {
    const name = document.getElementById('item-name').value?.trim();
    const desc = document.getElementById('item-desc').value?.trim();

    if (!name) {
      showToast('请输入物品名称', 'error');
      return;
    }

    const items = getData(STORAGE_KEYS.ITEMS);
    const newItem = {
      id: generateId(),
      name,
      desc: desc || '暂无描述',
      owner: '我',
      status: 'available',
      addedAt: new Date().toISOString()
    };

    items.unshift(newItem);
    const success = saveData(STORAGE_KEYS.ITEMS, items);

    if (success) {
      closeAddItemModal();
      renderItems();
      showToast('物资上架成功！');
    }
  };

  // 申请借用物资
  window.borrowItem = function(itemId) {
    const items = getData(STORAGE_KEYS.ITEMS);
    const item = items.find(i => i.id === itemId);

    if (!item || item.status !== 'available') {
      showToast('该物资不可借用', 'error');
      return;
    }

    if (confirm(`确定要向 ${item.owner} 申请借用 "${item.name}" 吗？`)) {
      item.status = 'borrowed';
      item.borrower = '我';
      item.borrowedAt = new Date().toISOString();
      
      saveData(STORAGE_KEYS.ITEMS, items);
      renderItems();
      showToast('借用申请已发送 (模拟)');
    }
  };
}

/**
 * 渲染物资列表
 */
function renderItems() {
  const grid = document.getElementById('items-grid');
  if (!grid) return;

  const items = getData(STORAGE_KEYS.ITEMS);
  if (items.length === 0) {
    grid.innerHTML = '<p class="text-gray-500 text-center py-8 col-span-full">暂无共享物资</p>';
    return;
  }

  grid.innerHTML = items.map(item => {
    const isAvailable = item.status === 'available';
    const btnClass = isAvailable 
      ? 'bg-green-600 hover:bg-green-700 text-white' 
      : 'bg-gray-300 text-gray-500 cursor-not-allowed';
    const btnText = isAvailable ? '申请借用' : '已借出';
    const icon = isAvailable ? 'fa-hand-holding-hand' : 'fa-ban';

    return `
      <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
        <div class="h-32 bg-gray-100 flex items-center justify-center text-gray-300">
          <i class="fa-solid fa-box text-6xl"></i>
        </div>
        <div class="p-4 flex-1 flex flex-col">
          <div class="flex justify-between items-start">
            <h3 class="font-bold text-gray-900">${escapeHtml(item.name)}</h3>
            <span class="text-xs text-gray-400">by ${escapeHtml(item.owner)}</span>
          </div>
          <p class="text-sm text-gray-500 mt-2 mb-4 flex-1">${escapeHtml(item.desc)}</p>
          <button onclick="${isAvailable ? `borrowItem('${item.id}')` : ''}" 
                  ${!isAvailable ? 'disabled' : ''} 
                  class="w-full py-2 rounded-lg font-medium transition flex items-center justify-center gap-2 ${btnClass}">
            <i class="fa-solid ${icon}"></i> ${btnText}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// ================== 课作业查询模块 ==================

/**
 * 初始化课作业查询模块
 */
function initCoursesModule() {
  renderCourseList();
  bindCourseEvents();
}

/**
 * 绑定课程相关事件
 */
function bindCourseEvents() {
  // 打开/关闭新建课程模态框
  window.openAddCourseModal = function() {
    if (!checkPermission('create_course')) {
      showToast('您没有权限创建课程', 'error');
      return;
    }
    document.getElementById('add-course-modal').classList.remove('hidden');
  };

  window.closeAddCourseModal = function() {
    document.getElementById('add-course-modal').classList.add('hidden');
    document.getElementById('course-name-input').value = '';
    document.getElementById('teacher-name-input').value = '';
  };

  // 添加课程
  window.addCourse = function() {
    if (!checkPermission('create_course')) {
      showToast('您没有权限创建课程', 'error');
      return;
    }

    const name = document.getElementById('course-name-input').value?.trim();
    const teacher = document.getElementById('teacher-name-input').value?.trim();

    if (!name || !teacher) {
      showToast('请填写完整信息', 'error');
      return;
    }

    const courses = getData(STORAGE_KEYS.COURSES);
    const newCourse = {
      id: generateId(),
      name,
      teacher,
      intel: [],
      createdAt: new Date().toISOString()
    };

    courses.push(newCourse);
    const success = saveData(STORAGE_KEYS.COURSES, courses);

    if (success) {
      closeAddCourseModal();
      renderCourseList();
      showToast('课程主页创建成功！');
    }
  };

  // 选择课程
  window.selectCourse = function(courseId) {
    const courses = getData(STORAGE_KEYS.COURSES);
    const course = courses.find(c => c.id === courseId);
    if (!course) return;

    // 更新状态
    window.currentCourseId = courseId;

    // 更新UI
    document.querySelectorAll('#course-list .p-3').forEach(el => {
      el.classList.remove('bg-indigo-50', 'border-indigo-200');
      el.classList.add('hover:bg-gray-50', 'border-transparent');
    });
    const selectedEl = document.querySelector(`#course-list [onclick="selectCourse('${courseId}')"]`);
    if (selectedEl) {
      selectedEl.classList.remove('hover:bg-gray-50', 'border-transparent');
      selectedEl.classList.add('bg-indigo-50', 'border-indigo-200');
    }

    // 显示课程详情
    document.getElementById('course-empty-state').classList.add('hidden');
    document.getElementById('course-detail-panel').classList.remove('hidden');
    
    document.getElementById('detail-course-name').textContent = course.name;
    document.getElementById('detail-teacher-name').textContent = `授课教师: ${course.teacher}`;
    
    renderIntelList(course);
  };

  // 打开/关闭上传情报模态框
  window.openUploadInfoModal = function() {
    if (!window.currentCourseId) {
      showToast('请先选择课程', 'error');
      return;
    }
    document.getElementById('upload-intel-modal').classList.remove('hidden');
  };

  window.closeUploadInfoModal = function() {
    document.getElementById('upload-intel-modal').classList.add('hidden');
    document.getElementById('intel-title').value = '';
    document.getElementById('intel-content').value = '';
  };

  // 上传情报
  window.uploadIntel = function() {
    if (!window.currentCourseId) {
      showToast('请先选择课程', 'error');
      return;
    }

    const type = document.getElementById('intel-type').value;
    const title = document.getElementById('intel-title').value?.trim();
    const content = document.getElementById('intel-content').value?.trim();

    if (!title || !content) {
      showToast('请填写完整信息', 'error');
      return;
    }

    const courses = getData(STORAGE_KEYS.COURSES);
    const course = courses.find(c => c.id === window.currentCourseId);
    if (!course) return;

    const now = new Date();
    const dateStr = `${now.getMonth()+1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

    course.intel.unshift({
      type,
      title,
      content,
      date: dateStr
    });

    const success = saveData(STORAGE_KEYS.COURSES, courses);
    if (success) {
      closeUploadInfoModal();
      renderIntelList(course);
      showToast('情报上传成功！');
    }
  };

  // AI助教查询
  window.askLLM = function() {
    const input = document.getElementById('llm-input');
    const query = input.value?.trim();
    const responseArea = document.getElementById('llm-response-area');
    const responseText = document.getElementById('llm-text');
    const citations = document.getElementById('llm-citations');

    if (!query) return;
    if (!window.currentCourseId) {
      showToast('请先选择一门课程', 'error');
      return;
    }

    responseArea.classList.remove('hidden');
    responseText.textContent = '正在思考...';
    citations.classList.add('hidden');

    // 模拟API延迟
    setTimeout(() => {
      const courses = getData(STORAGE_KEYS.COURSES);
      const course = courses.find(c => c.id === window.currentCourseId);
      let answer = "";
      let hasCitation = false;

      // 简单关键词匹配模拟
      const lowerQuery = query.toLowerCase();
      const relevantIntel = course.intel.filter(i => 
        i.title.toLowerCase().includes(lowerQuery) || 
        i.content.toLowerCase().includes(lowerQuery) || 
        i.type.includes(lowerQuery)
      );

      if (relevantIntel.length > 0) {
        answer = `根据课程情报，关于 "${query}" 的信息如下：\n`;
        relevantIntel.forEach((intel, idx) => {
          answer += `${idx+1}. [${intel.type}] ${intel.title}: ${intel.content}\n`;
        });
        hasCitation = true;
      } else {
        answer = `暂时没有找到关于 "${query}" 的具体情报。建议查看课程公告或询问老师。`;
      }

      // 打字机效果
      responseText.textContent = '';
      let i = 0;
      const typeInterval = setInterval(() => {
        responseText.textContent += answer.charAt(i);
        i++;
        if (i >= answer.length) {
          clearInterval(typeInterval);
          if (hasCitation) {
            citations.classList.remove('hidden');
            citations.innerHTML = `<i class="fa-solid fa-quote-left mr-1"></i> 引用来源: ${course.name} 情报库`;
          }
        }
      }, 30);

    }, 1000);
  };
}

/**
 * 渲染课程列表
 */
function renderCourseList() {
  const list = document.getElementById('course-list');
  if (!list) return;

  const courses = getData(STORAGE_KEYS.COURSES);
  if (courses.length === 0) {
    list.innerHTML = '<p class="text-gray-500 text-center py-8">暂无课程</p>';
    return;
  }

  list.innerHTML = '';
  courses.forEach(course => {
    const isActive = window.currentCourseId === course.id;
    const item = document.createElement('div');
    item.className = `p-3 rounded-lg cursor-pointer transition flex justify-between items-center ${isActive ? 'bg-indigo-50 border border-indigo-200' : 'hover:bg-gray-50 border border-transparent'}`;
    item.onclick = () => selectCourse(course.id);
    item.innerHTML = `
      <div>
        <div class="font-medium text-gray-800">${escapeHtml(course.name)}</div>
        <div class="text-xs text-gray-500">${escapeHtml(course.teacher)}</div>
      </div>
      <i class="fa-solid fa-chevron-right text-gray-300 text-xs"></i>
    `;
    list.appendChild(item);
  });
}

/**
 * 渲染课程情报列表
 * @param {Object} course 
 */
function renderIntelList(course) {
  const container = document.getElementById('course-intel-list');
  if (!container) return;

  if (!course.intel || course.intel.length === 0) {
    container.innerHTML = '<p class="text-sm text-gray-400 italic">暂无情报，快来上传第一条吧！</p>';
    return;
  }

  container.innerHTML = course.intel.map(intel => `
    <div class="bg-gray-50 p-3 rounded border border-gray-100">
      <div class="flex justify-between items-center mb-1">
        <span class="text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-700">${intel.type}</span>
        <span class="text-xs text-gray-400">${intel.date}</span>
      </div>
      <h5 class="font-bold text-gray-800 text-sm">${escapeHtml(intel.title)}</h5>
      <p class="text-sm text-gray-600 mt-1">${escapeHtml(intel.content)}</p>
    </div>
  `).join('');
}

// ================== 文档资源共享模块 ==================

/**
 * 初始化文档资源模块
 */
function initDocsModule() {
  renderFiles();
  bindDocEvents();
}

/**
 * 绑定文档相关事件
 */
function bindDocEvents() {
  // 文件上传处理
  window.handleFileUpload = function(input) {
    if (!checkPermission('upload_document')) {
      showToast('您没有权限上传文件', 'error');
      input.value = '';
      return;
    }

    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      
      reader.onload = function(e) {
        const files = getData(STORAGE_KEYS.DOCUMENTS);
        const newFile = {
          id: generateId(),
          name: file.name,
          type: file.name.split('.').pop().toUpperCase() || 'FILE',
          size: formatFileSize(file.size),
          uploader: '我',
          uploadedAt: new Date().toISOString(),
          content: e.target.result // base64编码的内容
        };

        files.unshift(newFile);
        const success = saveData(STORAGE_KEYS.DOCUMENTS, files);

        if (success) {
          renderFiles();
          showToast('文件上传成功！');
        }
      };

      reader.readAsDataURL(file); // 读取为base64
    }
  };

  // 下载文件
  window.downloadFile = function(fileName) {
    const files = getData(STORAGE_KEYS.DOCUMENTS);
    const file = files.find(f => f.name === fileName);
    
    if (file && file.content) {
      const link = document.createElement('a');
      link.href = file.content;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast(`开始下载 ${fileName}...`, 'info');
    } else {
      showToast('文件不存在或已损坏', 'error');
    }
  };

  // 删除文件（仅管理员）
  window.deleteFile = function(fileId) {
    if (!checkPermission('delete_document')) {
      showToast('您没有权限删除文件', 'error');
      return;
    }

    if (!confirm('确定要删除此文件吗？此操作不可撤销。')) {
      return;
    }

    const files = getData(STORAGE_KEYS.DOCUMENTS);
    const index = files.findIndex(f => f.id === fileId);
    
    if (index !== -1) {
      files.splice(index, 1);
      const success = saveData(STORAGE_KEYS.DOCUMENTS, files);
      
      if (success) {
        renderFiles();
        showToast('文件已删除');
      }
    }
  };
}

/**
 * 格式化文件大小显示
 * @param {number} bytes 
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * 获取文件图标类名
 * @param {string} fileType 
 * @returns {string}
 */
function getFileIcon(fileType) {
  const type = fileType.toLowerCase();
  if (type.includes('pdf')) return 'fa-file-pdf';
  if (type.includes('word') || type.includes('doc')) return 'fa-file-word';
  if (type.includes('excel') || type.includes('xls')) return 'fa-file-excel';
  if (type.includes('zip') || type.includes('rar')) return 'fa-file-zipper';
  if (type.includes('ppt') || type.includes('powerpoint')) return 'fa-file-powerpoint';
  return 'fa-file';
}

/**
 * 渲染文件列表
 */
function renderFiles() {
  const tbody = document.getElementById('file-list-body');
  const emptyMsg = document.getElementById('empty-files-msg');
  if (!tbody || !emptyMsg) return;

  const files = getData(STORAGE_KEYS.DOCUMENTS);
  
  if (files.length === 0) {
    emptyMsg.classList.remove('hidden');
    tbody.innerHTML = '';
    return;
  } else {
    emptyMsg.classList.add('hidden');
  }

  tbody.innerHTML = files.map(file => {
    const canDelete = checkPermission('delete_document');
    return `
      <tr>
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="flex items-center">
            <div class="flex-shrink-0 h-8 w-8 bg-gray-100 rounded flex items-center justify-center text-gray-500">
              <i class="fa-solid ${getFileIcon(file.type)}"></i>
            </div>
            <div class="ml-4">
              <div class="text-sm font-medium text-gray-900">${escapeHtml(file.name)}</div>
            </div>
          </div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${escapeHtml(file.type)}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${file.size}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${escapeHtml(file.uploader)}</td>
        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
          <button onclick="downloadFile('${escapeHtml(file.name)}')" class="text-indigo-600 hover:text-indigo-900 mr-3"><i class="fa-solid fa-download"></i> 下载</button>
          ${canDelete ? `<button onclick="deleteFile('${file.id}')" class="text-red-600 hover:text-red-900"><i class="fa-solid fa-trash"></i> 删除</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

// ================== 导航与页面初始化 ==================

/**
 * 切换页面标签显示
 * @param {string} tabId - 目标标签ID：'info', 'items', 'courses', 'docs'
 */
function switchTab(tabId) {
  // 隐藏所有模块
  document.querySelectorAll('.tab-content').forEach(el => {
    el.classList.remove('active');
  });
  // 移除所有导航按钮的激活状态
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('text-indigo-600', 'border-indigo-600');
    btn.classList.add('text-gray-500', 'border-transparent');
  });

  // 显示目标模块
  const targetPanel = document.getElementById(tabId);
  const targetBtn = document.querySelector(`[data-target="${tabId}"]`);
  if (targetPanel) targetPanel.classList.add('active');
  if (targetBtn) {
    targetBtn.classList.remove('text-gray-500', 'border-transparent');
    targetBtn.classList.add('text-indigo-600', 'border-b-2', 'border-indigo-600');
  }

  // 关闭移动端菜单
  const mobileMenu = document.getElementById('mobile-menu');
  if (mobileMenu && !window.matchMedia('(min-width: 640px)').matches) {
    mobileMenu.classList.add('hidden');
  }

  // 触发模块初始化
  initTabModule(tabId);
}

/**
 * 初始化指定标签页的模块
 * @param {string} tabId 
 */
function initTabModule(tabId) {
  switch (tabId) {
    case 'info':
      initInfoModule();
      break;
    case 'items':
      initItemsModule();
      break;
    case 'courses':
      initCoursesModule();
      break;
    case 'docs':
      initDocsModule();
      break;
  }
}

/**
 * 页面初始化
 */
document.addEventListener('DOMContentLoaded', function() {
  // 初始化导航事件
  document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
    document.getElementById('mobile-menu')?.classList.toggle('hidden');
  });

  // 绑定登录事件
  const loginBtn = document.querySelector('#login-form-container button');
  if (loginBtn) {
    loginBtn.onclick = handleLogin;
  }

  // 绑定注销事件
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.onclick = handleLogout;
  }

  // 检查认证状态
  checkAuthOnLoad();

  // 初始化当前标签页
  initTabModule('info');
});