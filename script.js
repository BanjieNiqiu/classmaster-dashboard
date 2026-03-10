/**
 * script.js - 班级班务管理系统交互逻辑主文件
 * 实现四大功能模块的前端交互：信息收集、物资共享、课作业查询、文档资源
 * 使用 localStorage 持久化存储数据，确保刷新后数据不丢失
 * 包含表单验证、状态管理、用户反馈提示等完整交互流程
 */

// ================== 全局常量定义 ==================

const STORAGE_KEYS = {
  INFO_FORMS: 'classmaster_info_forms',           // 班委创建的信息收集表单列表
  INFO_SUBMISSIONS: 'classmaster_info_submissions', // 同学提交的表单数据
  ITEMS: 'classmaster_shared_items',              // 共享物资列表
  COURSES: 'classmaster_courses',                 // 课程列表
  COURSE_INTELLIGENCE: 'classmaster_course_intel', // 课程情报（作业/通知）
  DOCUMENTS: 'classmaster_documents'              // 文档资源元数据
};

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
  const targetPanel = document.getElementById(`${tabId}-panel`);
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

  // 触发自定义事件（可用于初始化模块）
  window.dispatchEvent(new CustomEvent('tabswitched', { detail: { tabId } }));
}

// ================== 信息收集模块 ==================

/**
 * 初始化信息收集模块
 */
function initInfoModule() {
  renderFormList();
  renderSubmissionList();

  // 绑定创建表单提交事件
  const createForm = document.getElementById('create-info-form');
  if (createForm) {
    createForm.addEventListener('submit', handleCreateFormSubmit);
  }

  // 绑定填写表单提交事件
  const submitForm = document.getElementById('submit-info-form');
  if (submitForm) {
    submitForm.addEventListener('submit', handleFormSubmission);
  }
}

/**
 * 处理班委创建新表单提交
 * @param {Event} e
 */
function handleCreateFormSubmit(e) {
  e.preventDefault();
  const titleInput = document.getElementById('form-title');
  const descInput = document.getElementById('form-desc');
  const fieldsContainer = document.getElementById('form-fields');

  const title = (titleInput.value || '').trim();
  const description = (descInput.value || '').trim();

  if (!title) {
    showToast('请填写表单标题', 'error');
    return;
  }

  // 收集字段配置
  const fields = [];
  Array.from(fieldsContainer.children).forEach(fieldGroup => {
    const labelInput = fieldGroup.querySelector('[name="field-label"]');
    const typeSelect = fieldGroup.querySelector('[name="field-type"]');
    const requiredCheckbox = fieldGroup.querySelector('[name="field-required"]');

    const label = (labelInput?.value || '').trim();
    const type = typeSelect?.value || 'text';
    const required = requiredCheckbox?.checked || false;

    if (label) {
      fields.push({ id: generateId(), label, type, required });
    }
  });

  if (fields.length === 0) {
    showToast('至少添加一个表单字段', 'error');
    return;
  }

  const newForm = {
    id: generateId(),
    title,
    description,
    fields,
    createdAt: new Date().toISOString(),
    status: 'active' // active, closed
  };

  const forms = getData(STORAGE_KEYS.INFO_FORMS);
  forms.unshift(newForm); // 最新的在前面
  const success = saveData(STORAGE_KEYS.INFO_FORMS, forms);

  if (success) {
    titleInput.value = '';
    descInput.value = '';
    fieldsContainer.innerHTML = '';
    renderFormList();
    showToast('表单创建成功！');
  }
}

/**
 * 添加一个新的表单字段输入行
 */
function addFormField() {
  const container = document.getElementById('form-fields');
  const fieldId = generateId();
  const fieldGroup = document.createElement('div');
  fieldGroup.className = 'field-group bg-gray-50 p-4 rounded-md space-y-3 mb-3 border';
  fieldGroup.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
      <div class="md:col-span-2">
        <label class="block text-sm font-medium text-gray-700 mb-1">字段名称 *</label>
        <input type="text" name="field-label" placeholder="例如：姓名、学号" required class="form-control" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">类型</label>
        <select name="field-type" class="form-control">
          <option value="text">单行文本</option>
          <option value="textarea">多行文本</option>
          <option value="number">数字</option>
          <option value="date">日期</option>
          <option value="select">下拉选择</option>
        </select>
      </div>
      <div class="flex items-center">
        <label class="checkbox-label">
          <input type="checkbox" name="field-required" class="checkbox-input" />
          <span class="checkbox-custom"></span>
          <span class="ml-2 text-sm">必填</span>
        </label>
        <button type="button" onclick="removeFormField(this)" class="ml-4 text-red-500 hover:text-red-700 text-sm">删除</button>
      </div>
    </div>
    <!-- 动态选项区域（仅当类型为 select 时显示） -->
    <div class="options-container hidden">
      <label class="block text-sm font-medium text-gray-700 mb-1">选项（每行一个）</label>
      <textarea name="field-options" placeholder="选项1&#10;选项2&#10;选项3" class="form-control" rows="2"></textarea>
    </div>
  `;
  container.appendChild(fieldGroup);

  // 绑定类型切换事件
  const typeSelect = fieldGroup.querySelector('[name="field-type"]');
  typeSelect.addEventListener('change', function () {
    const optionsContainer = fieldGroup.querySelector('.options-container');
    if (this.value === 'select') {
      optionsContainer.classList.remove('hidden');
    } else {
      optionsContainer.classList.add('hidden');
    }
  });
}

/**
 * 删除一个表单字段行
 * @param {HTMLElement} button - 删除按钮元素
 */
function removeFormField(button) {
  const group = button.closest('.field-group');
  if (group && document.getElementById('form-fields').children.length > 1) {
    group.remove();
  } else {
    showToast('至少保留一个字段', 'error');
  }
}

/**
 * 渲染可填写的表单列表
 */
function renderFormList() {
  const container = document.getElementById('available-forms');
  if (!container) return;

  const forms = getData(STORAGE_KEYS.INFO_FORMS).filter(f => f.status === 'active');
  if (forms.length === 0) {
    container.innerHTML = '<p class="text-gray-500 text-center py-8">暂无开放的表单</p>';
    return;
  }

  container.innerHTML = forms.map(form => `
    <div class="bg-white p-5 rounded-lg shadow border hover:border-indigo-300 transition-colors cursor-pointer"
         onclick="loadFormForSubmission('${form.id}')">
      <h3 class="font-semibold text-gray-800 text-lg mb-2">${escapeHtml(form.title)}</h3>
      ${form.description ? `<p class="text-gray-600 text-sm mb-3 line-clamp-2">${escapeHtml(form.description)}</p>` : ''}
      <div class="flex justify-between items-center text-xs text-gray-500">
        <span>字段数：${form.fields.length}</span>
        <span>创建于：${formatDate(form.createdAt)}</span>
      </div>
    </div>
  `).join('');
}

/**
 * 加载指定表单用于填写
 * @param {string} formId
 */
function loadFormForSubmission(formId) {
  const forms = getData(STORAGE_KEYS.INFO_FORMS);
  const form = forms.find(f => f.id === formId);
  if (!form) {
    showToast('表单不存在或已关闭', 'error');
    return;
  }

  const modal = document.getElementById('submission-modal');
  const formTitle = document.getElementById('filling-form-title');
  const fieldsContainer = document.getElementById('filling-form-fields');
  const hiddenInput = document.getElementById('filled-form-id');

  formTitle.textContent = form.title;
  hiddenInput.value = formId;

  // 动态生成填写表单字段
  fieldsContainer.innerHTML = form.fields.map(field => {
    const isRequired = field.required ? 'required' : '';
    let inputHtml = '';

    if (field.type === 'textarea') {
      inputHtml = `<textarea name="field-${field.id}" placeholder="请输入${field.label}" ${isRequired} class="form-control mt-1" rows="3"></textarea>`;
    } else if (field.type === 'select') {
      const options = (field.options || ['未配置选项']).map(opt => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join('');
      inputHtml = `<select name="field-${field.id}" ${isRequired} class="form-control mt-1"><option value="">请选择</option>${options}</select>`;
    } else {
      inputHtml = `<input type="${field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}" 
                           name="field-${field.id}" 
                           placeholder="请输入${field.label}" 
                           ${isRequired} 
                           class="form-control mt-1">`;
    }

    return `
      <div class="space-y-2">
        <label class="block font-medium text-gray-700">
          ${escapeHtml(field.label)} ${field.required ? '<span class="text-red-500">*</span>' : ''}
        </label>
        ${inputHtml}
      </div>
    `;
  }).join('');

  // 显示模态框（这里简化处理，直接显示隐藏区域）
  document.getElementById('main-content').classList.add('hidden');
  document.getElementById('submission-form-container').classList.remove('hidden');
}

/**
 * 处理同学提交表单数据
 * @param {Event} e
 */
function handleFormSubmission(e) {
  e.preventDefault();
  const formData = new FormData(e.target);
  const formId = formData.get('filled-form-id');
  const submissionId = generateId();
  const timestamp = new Date().toISOString();

  const forms = getData(STORAGE_KEYS.INFO_FORMS);
  const form = forms.find(f => f.id === formId);
  if (!form) {
    showToast('表单无效', 'error');
    return;
  }

  // 收集所有字段值
  const values = {};
  form.fields.forEach(field => {
    const key = `field-${field.id}`;
    const value = formData.get(key);
    if (field.required && (!value || value.trim() === '')) {
      showToast(`请填写必填项：${field.label}`, 'error');
      return;
    }
    values[field.id] = value || '';
  });

  if (Object.keys(values).length === 0) return; // 验证中断

  const submission = {
    id: submissionId,
    formId,
    values,
    submittedAt: timestamp,
    submitterName: formData.get('submitter-name') || '匿名同学' // 假设有姓名输入
  };

  const submissions = getData(STORAGE_KEYS.INFO_SUBMISSIONS);
  submissions.push(submission);
  const success = saveData(STORAGE_KEYS.INFO_SUBMISSIONS, submissions);

  if (success) {
    // 重置并返回
    e.target.reset();
    document.getElementById('submission-form-container').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');
    showToast('表单提交成功！感谢配合');
  }
}

/**
 * 渲染已提交的表单记录列表（班委视图）
 */
function renderSubmissionList() {
  const container = document.getElementById('submission-list');
  if (!container) return;

  const submissions = getData(STORAGE_KEYS.INFO_SUBMISSIONS);
  const forms = getData(STORAGE_KEYS.INFO_FORMS);
  if (submissions.length === 0) {
    container.innerHTML = '<p class="text-gray-500 text-center py-8">暂无提交记录</p>';
    return;
  }

  // 按表单分组
  const grouped = {};
  submissions.forEach(sub => {
    if (!grouped[sub.formId]) grouped[sub.formId] = [];
    grouped[sub.formId].push(sub);
  });

  container.innerHTML = Object.entries(grouped).map(([formId, subs]) => {
    const form = forms.find(f => f.id === formId);
    const formTitle = form ? form.title : '未知表单';
    return `
      <div class="mb-8">
        <h3 class="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">${escapeHtml(formTitle)} (${subs.length}人提交)</h3>
        <div class="space-y-3">
          ${subs.map(sub => `
            <div class="bg-white p-4 rounded border flex justify-between items-center">
              <div>
                <p class="font-medium text-gray-800">${escapeHtml(sub.submitterName)}</p>
                <p class="text-sm text-gray-500">提交于：${formatDate(sub.submittedAt)}</p>
              </div>
              <button onclick="viewSubmissionDetail('${sub.id}')" class="btn btn-outline text-sm">查看详情</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 查看具体提交详情（弹窗模拟）
 * @param {string} subId
 */
function viewSubmissionDetail(subId) {
  const submissions = getData(STORAGE_KEYS.INFO_SUBMISSIONS);
  const sub = submissions.find(s => s.id === subId);
  const forms = getData(STORAGE_KEYS.INFO_FORMS);
  const form = forms.find(f => f.id === sub.formId);

  if (!sub || !form) {
    showToast('数据不存在', 'error');
    return;
  }

  const detailHtml = form.fields.map(field => {
    const value = sub.values[field.id] || '（未填写）';
    return `
      <div class="mb-4">
        <p class="font-medium text-gray-700">${escapeHtml(field.label)}：</p>
        <p class="text-gray-800 whitespace-pre-wrap">${escapeHtml(value)}</p>
      </div>
    `;
  }).join('');

  alert(`提交详情\n\n${form.title}\n提交人：${sub.submitterName}\n时间：${formatDate(sub.submittedAt)}\n\n${detailHtml}`);
}

// ================== 物资共享模块 ==================

/**
 * 初始化物资共享模块
 */
function initItemsModule() {
  renderItemsList();
  const form = document.getElementById('item-listing-form');
  if (form) {
    form.addEventListener('submit', handleItemListingSubmit);
  }
}

/**
 * 处理上架物资表单提交
 * @param {Event} e
 */
function handleItemListingSubmit(e) {
  e.preventDefault();
  const nameInput = document.getElementById('item-name');
  const descInput = document.getElementById('item-desc');
  const quantityInput = document.getElementById('item-quantity');

  const name = (nameInput.value || '').trim();
  const description = (descInput.value || '').trim();
  const quantityStr = (quantityInput.value || '').trim();

  if (!name) {
    showToast('请填写物资名称', 'error');
    return;
  }

  const quantity = parseInt(quantityStr, 10);
  if (isNaN(quantity) || quantity <= 0) {
    showToast('请填写有效数量（大于0的整数）', 'error');
    return;
  }

  const newItem = {
    id: generateId(),
    name,
    description,
    totalQuantity: quantity,
    availableQuantity: quantity,
    listedAt: new Date().toISOString(),
    status: 'available' // available, borrowed, maintenance
  };

  const items = getData(STORAGE_KEYS.ITEMS);
  items.unshift(newItem);
  const success = saveData(STORAGE_KEYS.ITEMS, items);

  if (success) {
    e.target.reset();
    renderItemsList();
    showToast('物资上架成功！');
  }
}

/**
 * 渲染物资列表
 */
function renderItemsList() {
  const container = document.getElementById('items-list');
  if (!container) return;

  const items = getData(STORAGE_KEYS.ITEMS);
  if (items.length === 0) {
    container.innerHTML = '<p class="text-gray-500 text-center py-8">暂无共享物资</p>';
    return;
  }

  container.innerHTML = items.map(item => {
    const isAvailable = item.availableQuantity > 0;
    const statusText = isAvailable ? '可借用' : '已借完';
    const statusColor = isAvailable ? 'text-green-600 bg-green-100' : 'text-gray-600 bg-gray-100';

    return `
      <div class="item-card">
        <div class="item-card-header">
          <h3 class="item-card-title">${escapeHtml(item.name)}</h3>
          <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full ${statusColor}">
            ${statusText}
          </span>
        </div>
        <p class="item-card-description text-gray-600 mb-4">${escapeHtml(item.description)}</p>
        <div class="item-card-meta text-sm text-gray-500 mb-4">
          可用：${item.availableQuantity}/${item.totalQuantity} 件
        </div>
        <div class="mt-auto">
          <button 
            onclick="handleBorrowItemClick('${item.id}')" 
            class="btn btn-primary w-full ${!isAvailable ? 'opacity-50 cursor-not-allowed' : ''}"
            ${!isAvailable ? 'disabled' : ''}>
            申请借用
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 处理申请借用按钮点击
 * @param {string} itemId
 */
function handleBorrowItemClick(itemId) {
  const items = getData(STORAGE_KEYS.ITEMS);
  const itemIndex = items.findIndex(i => i.id === itemId);
  if (itemIndex === -1) {
    showToast('物资不存在', 'error');
    return;
  }

  const item = items[itemIndex];
  if (item.availableQuantity <= 0) {
    showToast('该物资当前不可借用', 'error');
    return;
  }

  // 模拟借用确认对话框
  const confirm = window.confirm(`确定要借用【${item.name}】吗？\n可用数量：${item.availableQuantity}件`);
  if (confirm) {
    items[itemIndex].availableQuantity -= 1;
    if (items[itemIndex].availableQuantity === 0) {
      items[itemIndex].status = 'borrowed';
    }

    const success = saveData(STORAGE_KEYS.ITEMS, items);
    if (success) {
      renderItemsList();
      showToast(`成功申请借用【${item.name}】！请按时归还。`);
    }
  }
}

// ================== 课作业查询模块 ==================

/**
 * 初始化课作业查询模块
 */
function initCoursesModule() {
  renderCoursesList();
  renderCourseIntelList();

  // 绑定表单事件
  const courseForm = document.getElementById('course-create-form');
  if (courseForm) {
    courseForm.addEventListener('submit', handleCourseCreateSubmit);
  }

  const intelForm = document.getElementById('intel-upload-form');
  if (intelForm) {
    intelForm.addEventListener('submit', handleIntelUploadSubmit);
  }

  // 手动查询事件
  const searchInput = document.getElementById('intel-search');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(handleManualSearch, 300));
  }

  // LLM 查询按钮
  const llmQueryBtn = document.getElementById('llm-query-btn');
  if (llmQueryBtn) {
    llmQueryBtn.addEventListener('click', handleLLMQuery);
  }
}

/**
 * 处理新建课程提交
 * @param {Event} e
 */
function handleCourseCreateSubmit(e) {
  e.preventDefault();
  const nameInput = document.getElementById('course-name');
  const teacherInput = document.getElementById('course-teacher');

  const name = (nameInput.value || '').trim();
  const teacher = (teacherInput.value || '').trim();

  if (!name) {
    showToast('请填写课程名称', 'error');
    return;
  }

  const newCourse = {
    id: generateId(),
    name,
    teacher,
    createdAt: new Date().toISOString()
  };

  const courses = getData(STORAGE_KEYS.COURSES);
  courses.unshift(newCourse);
  const success = saveData(STORAGE_KEYS.COURSES, courses);

  if (success) {
    e.target.reset();
    renderCoursesList();
    showToast('课程添加成功！');
  }
}

/**
 * 渲染课程列表
 */
function renderCoursesList() {
  const container = document.getElementById('courses-list');
  if (!container) return;

  const courses = getData(STORAGE_KEYS.COURSES);
  if (courses.length === 0) {
    container.innerHTML = '<p class="text-gray-500 text-center py-8">暂无课程</p>';
    return;
  }

  container.innerHTML = courses.map(course => `
    <div class="bg-white p-4 rounded border mb-3">
      <h3 class="font-semibold text-gray-800">${escapeHtml(course.name)}</h3>
      <p class="text-sm text-gray-600">授课教师：${escapeHtml(course.teacher || '未指定')}</p>
      <p class="text-xs text-gray-500">添加于：${formatDate(course.createdAt)}</p>
    </div>
  `).join('');
}

/**
 * 处理上传课程情报提交
 * @param {Event} e
 */
function handleIntelUploadSubmit(e) {
  e.preventDefault();
  const titleInput = document.getElementById('intel-title');
  const contentTextarea = document.getElementById('intel-content');
  const courseSelect = document.getElementById('intel-course');

  const title = (titleInput.value || '').trim();
  const content = (contentTextarea.value || '').trim();
  const courseId = courseSelect?.value || null;

  if (!title) {
    showToast('请填写情报标题', 'error');
    return;
  }

  const newIntel = {
    id: generateId(),
    title,
    content,
    courseId,
    createdAt: new Date().toISOString(),
    author: '当前用户' // 实际系统中应从登录信息获取
  };

  const intelList = getData(STORAGE_KEYS.COURSE_INTELLIGENCE);
  intelList.unshift(newIntel);
  const success = saveData(STORAGE_KEYS.COURSE_INTELLIGENCE, intelList);

  if (success) {
    e.target.reset();
    renderCourseIntelList();
    showToast('情报上传成功！');
  }
}

/**
 * 渲染课程情报列表
 */
function renderCourseIntelList(filterKeyword = '') {
  const container = document.getElementById('intel-list');
  if (!container) return;

  const intelList = getData(STORAGE_KEYS.COURSE_INTELLIGENCE);
  const courses = getData(STORAGE_KEYS.COURSES);

  let filtered = intelList;
  if (filterKeyword) {
    const keyword = filterKeyword.toLowerCase();
    filtered = intelList.filter(item =>
      item.title.toLowerCase().includes(keyword) ||
      item.content.toLowerCase().includes(keyword)
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = '<p class="text-gray-500 text-center py-8">暂无匹配的情报</p>';
    return;
  }

  container.innerHTML = filtered.map(item => {
    const course = item.courseId ? courses.find(c => c.id === item.courseId) : null;
    return `
      <div class="bg-white p-4 rounded border mb-3">
        <div class="flex justify-between items-start mb-2">
          <h3 class="font-semibold text-gray-800 text-lg">${escapeHtml(item.title)}</h3>
          <span class="text-xs text-gray-500">${formatDate(item.createdAt)}</span>
        </div>
        ${course ? `<p class="text-sm text-indigo-600 mb-2">所属课程：${escapeHtml(course.name)}</p>` : ''}
        <p class="text-gray-700 whitespace-pre-line">${escapeHtml(item.content).replace(/\n/g, '<br>')}</p>
        <p class="text-xs text-gray-500 mt-3">发布者：${escapeHtml(item.author)}</p>
      </div>
    `;
  }).join('');
}

/**
 * 处理手动搜索
 */
function handleManualSearch() {
  const input = document.getElementById('intel-search');
  const keyword = input?.value || '';
  renderCourseIntelList(keyword);
}

/**
 * 处理 LLM 查询请求（模拟）
 */
function handleLLMQuery() {
  const responseDiv = document.getElementById('llm-response');
  if (!responseDiv) return;

  // 模拟加载状态
  responseDiv.innerHTML = '<p class="text-gray-600 typing-cursor">AI正在思考中...</p>';

  // 模拟网络延迟
  setTimeout(() => {
    responseDiv.innerHTML = `
      <div class="bg-blue-50 border border-blue-200 rounded p-4">
        <h4 class="font-semibold text-blue-800 mb-2">AI 总结结果</h4>
        <div class="text-blue-700 text-sm leading-relaxed">${DEFAULT_LLM_RESPONSE.replace(/\n/g, '<br>').replace(/> /g, '<span class="text-gray-500 text-xs">来源：</span>')}</div>
      </div>
    `;
    showToast('AI分析完成', 'info');
  }, 1500);
}

// ================== 文档资源模块 ==================

/**
 * 初始化文档资源模块
 */
function initDocsModule() {
  renderDocumentsList();

  const uploadForm = document.getElementById('doc-upload-form');
  if (uploadForm) {
    uploadForm.addEventListener('submit', handleDocUploadSubmit);
  }
}

/**
 * 处理文件上传表单提交（模拟）
 * @param {Event} e
 */
function handleDocUploadSubmit(e) {
  e.preventDefault();
  const fileInput = document.getElementById('doc-file');
  const titleInput = document.getElementById('doc-title');
  const descInput = document.getElementById('doc-desc');

  const files = fileInput?.files;
  const title = (titleInput.value || '').trim();
  const description = (descInput.value || '').trim();

  if (!files || files.length === 0) {
    showToast('请选择要上传的文件', 'error');
    return;
  }

  if (!title) {
    showToast('请填写文件标题', 'error');
    return;
  }

  const uploadedFiles = Array.from(files).map(file => {
    const docId = generateId();
    // 这里仅存储元数据，真实系统可能需要上传到服务器
    return {
      id: docId,
      title: title + (files.length > 1 ? ` (${file.name})` : ''),
      filename: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      description,
      uploadedAt: new Date().toISOString(),
      uploader: '当前用户',
      downloadUrl: `#download/${docId}` // 模拟下载链接
    };
  });

  const existingDocs = getData(STORAGE_KEYS.DOCUMENTS);
  const allDocs = [...uploadedFiles, ...existingDocs];
  const success = saveData(STORAGE_KEYS.DOCUMENTS, allDocs);

  if (success) {
    e.target.reset();
    renderDocumentsList();
    showToast(`成功上传 ${uploadedFiles.length} 个文件！`);
  }
}

/**
 * 渲染文档列表
 */
function renderDocumentsList() {
  const container = document.getElementById('docs-list');
  if (!container) return;

  const docs = getData(STORAGE_KEYS.DOCUMENTS);
  if (docs.length === 0) {
    container.innerHTML = '<p class="text-gray-500 text-center py-8">暂无共享文档</p>';
    return;
  }

  container.innerHTML = docs.map(doc => {
    const icon = getDocumentIcon(doc.type);
    const size = formatFileSize(doc.size);
    return `
      <div class="bg-white p-4 rounded border flex items-center justify-between mb-3">
        <div class="flex items-center space-x-3">
          <div class="text-2xl text-indigo-600">${icon}</div>
          <div>
            <h3 class="font-medium text-gray-800">${escapeHtml(doc.title)}</h3>
            <p class="text-sm text-gray-500">${escapeHtml(doc.filename)} · ${size} · ${formatDate(doc.uploadedAt)}</p>
            ${doc.description ? `<p class="text-sm text-gray-600 mt-1 line-clamp-1">${escapeHtml(doc.description)}</p>` : ''}
          </div>
        </div>
        <button 
          onclick="handleDownloadClick('${doc.id}', '${escapeJsString(doc.filename)}')"
          class="btn btn-outline text-sm whitespace-nowrap">
          下载
        </button>
      </div>
    `;
  }).join('');
}

/**
 * 获取文件类型对应图标（Font Awesome 类名）
 * @param {string} mimeType
 * @returns {string} HTML 字符实体或 SVG
 */
function getDocumentIcon(mimeType) {
  if (mimeType.includes('pdf')) return '📄';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📊';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return '📽️';
  if (mimeType.includes('image')) return '🖼️';
  if (mimeType.includes('zip') || mimeType.includes('archive')) return '📦';
  return '📎';
}

/**
 * 处理下载按钮点击（模拟）
 * @param {string} docId
 * @param {string} filename
 */
function handleDownloadClick(docId, filename) {
  // 在真实系统中，这里会触发文件下载
  showToast(`准备下载：${filename}...`, 'info');
  // 模拟下载过程
  setTimeout(() => {
    showToast(`${filename} 下载完成！`, 'success');
  }, 1000);
}

// ================== 页面初始化 ==================

/**
 * 页面加载完成后初始化所有模块
 */
document.addEventListener('DOMContentLoaded', function () {
  // 初始化各模块
  initInfoModule();
  initItemsModule();
  initCoursesModule();
  initDocsModule();
  initDocsModule();

  // 默认显示第一个标签页
  switchTab('info');

  // 绑定移动端菜单切换
  const mobileBtn = document.getElementById('mobile-menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');
  if (mobileBtn && mobileMenu) {
    mobileBtn.addEventListener('click', () => {
      mobileMenu.classList.toggle('hidden');
    });
  }

  // 监听标签切换事件（可用于懒加载）
  window.addEventListener('tabswitched', (e) => {
    const { tabId } = e.detail;
    console.log(`切换到标签页: ${tabId}`);
    // 可在此处添加按需加载逻辑
  });

  // 恢复上次打开的标签页（可选功能）
  const lastTab = localStorage.getItem('last_active_tab');
  if (lastTab && ['info', 'items', 'courses', 'docs'].includes(lastTab)) {
    switchTab(lastTab);
  }

  // 记录当前标签页
  window.addEventListener('tabswitched', (e) => {
    localStorage.setItem('last_active_tab', e.detail.tabId);
  });
});

// ================== 辅助函数 ==================

/**
 * 对 HTML 内容进行转义，防止 XSS
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * 转义字符串以用于 JavaScript 字符串字面量
 * @param {string} str
 * @returns {string}
 */
function escapeJsString(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
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
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 格式化日期显示
 * @param {string} isoString - ISO 8601 日期字符串
 * @returns {string} 格式化后的日期
 */
function formatDate(isoString) {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

/**
 * 防抖函数
 * @param {Function} func - 要防抖的函数
 * @param {number} wait - 延迟毫秒数
 * @returns {Function}
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}