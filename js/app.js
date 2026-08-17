/* ============================================================
 * 无穹书院课程评价系统 · 核心逻辑
 * 纯静态前端 + Supabase
 * ============================================================ */

// ---------- Supabase 客户端 ----------
// 注意：变量名用 sb 而非 supabase —— 第三方库在全局声明了 var supabase，
// 若这里再声明 const supabase 会报 "Identifier 'supabase' has already been declared"，
// 导致整个脚本无法执行。
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- 课程数据（来自《第一学年课程整理.md》） ----------
const COURSES = {
  autumn: [
    { id: "30420095", name: "高等微积分(1)" },
    { id: "10421055", name: "微积分A(1)" },
    { id: "30240233", name: "程序设计基础（计算机系）" },
    { id: "34100063", name: "程序设计基础（软院）" },
    { id: "10421324", name: "线性代数" },
    { id: "10680053", name: "思想道德与法治" },
    { id: "10680101", name: "形势与政策(1)-秋" },
    { id: "14201002", name: "英语(1)" },
    { id: "10691342", name: "写作与沟通" },
    { id: "10720011", name: "体育(1)" },
  ],
  spring: [
    { id: "30420105", name: "高等微积分(2)" },
    { id: "10421065", name: "微积分A(2)" },
    { id: "30240532", name: "面向对象程序设计基础（计算机系）" },
    { id: "34100362", name: "面向对象程序设计基础（软院）" },
    { id: "10880012", name: "概率论" },
    { id: "10430934", name: "大学物理A(1)" },
    { id: "10430484", name: "大学物理B(1)" },
    { id: "10430344", name: "大学物理(1)英" },
    { id: "10610193", name: "中国近现代史纲要" },
    { id: "10680131", name: "形势与政策(2)-春" },
    { id: "14201012", name: "英语(2)" },
    { id: "10720021", name: "体育(2)" },
  ],
  summer: [
    { id: "30940022", name: "AI基石设计" },
    { id: "10680092", name: "思政实践" },
  ],
};

const SEMESTERS = {
  autumn: { emoji: "🍂", name: "秋季学期", desc: "10 门课程 · 建议学分 21" },
  spring: { emoji: "🌸", name: "春季学期", desc: "12 门课程 · 建议学分 21" },
  summer: { emoji: "☀️", name: "夏季学期", desc: "2 门课程 · 建议学分 4" },
};

// ---------- 全局状态 ----------
let currentUser = null;        // { student_id }
let currentSemester = "autumn";
let currentCourse = null;      // { id, name }
let currentCounselor = null;   // 当前查看的导员 { id, name, ... }
let teachersCache = [];        // [{ id, course_id, name, ratings: [...], avg }]
let counselorsCache = [];      // 导员缓存 [{ id, semester, name, ratings, avg, myRating }]
let customCoursesCache = [];   // 同学自建课程缓存 [{ id, semester, course_id, name, created_by }]
let addTarget = "teacher";     // 添加弹窗目标：teacher | counselor
let realtimeChannel = null;    // 当前课程的实时订阅通道
let reloadTimer = null;        // 实时事件防抖定时器
let pendingReload = false;     // 用户正在输入时暂缓的刷新
let draftCache = {};           // 各面板输入草稿（评论+滑块），重建后恢复

const SESSION_KEY = "wq_cou…user";

// ---------- DOM 快捷引用 ----------
const $ = (sel) => document.querySelector(sel);
const viewAuth = $("#view-auth");
const viewApp = $("#view-app");

// ============================================================
// 认证：注册 / 登录 / 退出
// ============================================================
function showMsg(el, text, type) {
  el.textContent = text || "";
  el.className = "msg" + (type ? " " + type : "");
}

async function handleRegister(e) {
  e.preventDefault();
  const sid = $("#reg-id").value.trim();
  const pwd = $("#reg-pwd").value;
  const pwd2 = $("#reg-pwd2").value;
  const msgEl = $("#auth-msg");
  if (!sid) return showMsg(msgEl, "请输入学号", "err");
  if (!/^\d{4,12}$/.test(sid)) return showMsg(msgEl, "学号格式不正确（应为数字）", "err");
  if (pwd.length < 4) return showMsg(msgEl, "密码至少 4 位", "err");
  if (pwd !== pwd2) return showMsg(msgEl, "两次输入的密码不一致", "err");

  // 检查学号是否已注册
  const { data: exist, error: errExist } = await sb
    .from("users").select("student_id").eq("student_id", sid).maybeSingle();
  if (errExist) return showMsg(msgEl, "网络错误：" + errExist.message, "err");
  if (exist) return showMsg(msgEl, "该学号已注册，请直接登录", "err");

  const { error } = await sb.from("users").insert({ student_id: sid, password: pwd });
  if (error) return showMsg(msgEl, "注册失败：" + error.message, "err");

  showMsg(msgEl, "注册成功，正在登录…", "ok");
  enterApp(sid);
}

async function handleLogin(e) {
  e.preventDefault();
  const sid = $("#login-id").value.trim();
  const pwd = $("#login-pwd").value;
  const msgEl = $("#auth-msg");
  if (!sid || !pwd) return showMsg(msgEl, "请输入学号和密码", "err");

  const { data, error } = await sb
    .from("users").select("student_id, password").eq("student_id", sid).maybeSingle();
  if (error) return showMsg(msgEl, "网络错误：" + error.message, "err");
  if (!data || data.password !== pwd) return showMsg(msgEl, "学号或密码错误", "err");

  showMsg(msgEl, "登录成功…", "ok");
  enterApp(sid);
}

function enterApp(studentId) {
  currentUser = { student_id: studentId };
  localStorage.setItem(SESSION_KEY, studentId);
  viewAuth.hidden = true;
  viewApp.hidden = false;
  $("#header-user").textContent = "👤 " + studentId;
  renderSemesterTabs();
  switchSemester("autumn");
}

function handleLogout() {
  stopRealtime();
  currentUser = null;
  localStorage.removeItem(SESSION_KEY);
  viewApp.hidden = true;
  viewAuth.hidden = false;
  $("#login-id").value = "";
  $("#login-pwd").value = "";
  $("#auth-msg").textContent = "";
  $("#form-login").hidden = false;
  $("#form-register").hidden = true;
  document.querySelector('[data-auth-tab="login"]').classList.add("active");
  document.querySelector('[data-auth-tab="register"]').classList.remove("active");
}

// ============================================================
// 学期页
// ============================================================
function renderSemesterTabs() {
  const tabsEl = $("#semester-tabs");
  tabsEl.innerHTML = "";
  Object.entries(SEMESTERS).forEach(([key, meta]) => {
    const btn = document.createElement("button");
    btn.className = "sem-tab" + (key === currentSemester ? " active" : "");
    btn.dataset.sem = key;
    btn.innerHTML = `
      <span class="sem-emoji">${meta.emoji}</span>
      <span class="sem-name">${meta.name}</span>
      <span class="sem-desc">${meta.desc}</span>`;
    btn.addEventListener("click", () => switchSemester(key));
    tabsEl.appendChild(btn);
  });
  // 第四个标签：导员（全局板块，不按学期区分）
  const btn = document.createElement("button");
  btn.className = "sem-tab sem-tab-counselor" + (currentSemester === "counselor" ? " active" : "");
  btn.dataset.sem = "counselor";
  btn.innerHTML = `
    <span class="sem-emoji">🎓</span>
    <span class="sem-name">导员</span>
    <span class="sem-desc">全体导员 · 可评分/留言/传图</span>`;
  btn.addEventListener("click", () => switchSemester("counselor"));
  tabsEl.appendChild(btn);
}

function switchSemester(key) {
  currentSemester = key;
  document.querySelectorAll(".sem-tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.sem === key));
  const isCounselorTab = key === "counselor";
  $("#page-semester").hidden = isCounselorTab;
  $("#page-counselors").hidden = !isCounselorTab;
  if (isCounselorTab) renderCounselorGrid();
  else renderCourseGrid();
  subscribeRealtime();
}

async function renderCourseGrid() {
  const grid = $("#course-grid");
  grid.innerHTML = "";

  // 拉取同学自建的课程
  const { data: customs, error: errC } = await sb
    .from("custom_courses").select("id, semester, course_id, name, created_by")
    .eq("semester", currentSemester).order("created_at");
  if (errC) {
    grid.innerHTML = `<div class="empty-tip">课程加载失败：${escapeHtml(errC.message)}</div>`;
    return;
  }
  customCoursesCache = customs || [];

  const builtin = COURSES[currentSemester] || [];
  const list = [
    ...builtin,
    ...customCoursesCache.map((c) => ({
      id: c.course_id,
      name: c.name,
      custom: true,
      customId: c.id,
      createdBy: c.created_by,
    })),
  ];
  if (!list.length) {
    grid.innerHTML = '<div class="empty-tip">该学期暂无课程数据</div>';
    return;
  }
  // 按课程编号分组展示（编号相同的课程在一起）
  const byId = new Map();
  list.forEach((c) => {
    if (!byId.has(c.id)) byId.set(c.id, []);
    byId.get(c.id).push(c);
  });

  byId.forEach((group) => {
    const card = document.createElement("div");
    card.className = "course-card" + (group.some((c) => c.custom) ? " custom-course-card" : "");
    const first = group[0];
    const isCustom = !!first.custom;
    const canDeleteCourse = isCustom && first.createdBy === currentUser.student_id;
    card.innerHTML = `
      <span class="course-id">${first.id}${isCustom ? " · 自建" : ""}</span>
      <div class="course-name">${escapeHtml(first.name)}</div>
      <div class="course-num"><span class="dot">●</span> 点击查看老师评价${isCustom ? "（同学添加）" : ""}</div>
      ${canDeleteCourse ? `<button class="btn btn-danger btn-del-course">删除课程</button>` : ""}`;
    card.addEventListener("click", () => openCourse(first));
    if (canDeleteCourse) {
      card.querySelector(".btn-del-course").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteCustomCourse(first);
      });
    }
    grid.appendChild(card);
  });
}

// ============================================================
// 导员评价（每个学期独立，由学生自行添加，支持评分/留言/配图）
// ============================================================
async function renderCounselorGrid() {
  const grid = $("#counselor-grid");
  if (!grid) return;
  grid.innerHTML = '<div class="empty-tip" style="padding:24px 0">加载中…</div>';

  const { data: counselors, error: errC } = await sb
    .from("counselors").select("id, semester, name, created_by").order("created_at");
  if (errC) {
    grid.innerHTML = `<div class="empty-tip">导员加载失败：${escapeHtml(errC.message)}</div>`;
    return;
  }
  const ids = counselors.map((c) => c.id);
  let ratings = [];
  if (ids.length) {
    const { data, error: errR } = await sb
      .from("counselor_ratings").select("id, counselor_id, student_id, score, comment, image_url, created_at, updated_at")
      .in("counselor_id", ids).order("created_at", { ascending: true });
    if (errR) {
      grid.innerHTML = `<div class="empty-tip">导员加载失败：${escapeHtml(errR.message)}</div>`;
      return;
    }
    ratings = data || [];
  }

  counselorsCache = counselors.map((c) => ({
    ...c,
    ratings: ratings.filter((r) => r.counselor_id === c.id),
  }));
  counselorsCache.forEach((c) => {
    const n = c.ratings.length;
    c.avg = n ? c.ratings.reduce((s, r) => s + r.score, 0) / n : null;
    c.myRating = c.ratings.find((r) => r.student_id === currentUser.student_id) || null;
  });

  if (!counselorsCache.length) {
    grid.innerHTML = '<div class="empty-tip" style="padding:24px 0">还没有导员面板，点右上角「＋ 添加导员」创建</div>';
    return;
  }
  grid.innerHTML = "";
  counselorsCache.forEach((c) => {
    const card = document.createElement("div");
    card.className = "course-card counselor-card";
    card.innerHTML = `
      <span class="course-id">🎓 导员</span>
      <div class="course-name">${escapeHtml(c.name)}</div>
      <div class="course-num"><span class="dot">●</span> ${c.avg !== null ? "平均分 " + c.avg.toFixed(1) + " · " : ""}${c.ratings.length} 条评价 · 点击查看</div>`;
    card.addEventListener("click", () => openCounselor(c));
    grid.appendChild(card);
  });
}

function openCounselor(c) {
  currentCounselor = c;
  currentCourse = null;
  $("#page-semester").hidden = true;
  $("#page-counselors").hidden = true;
  $("#page-course").hidden = true;
  $("#page-counselor").hidden = false;
  $("#c-title").textContent = `导员：${c.name}`;
  $("#c-meta").textContent = `全体导员评价 · 实时同步已开启`;
  $("#c-panels").innerHTML = '<div class="empty-tip">加载中…</div>';
  loadCounselorDetail();
  subscribeRealtime();
}

async function loadCounselorDetail() {
  const panelsEl = $("#c-panels");
  const { data: counselor, error: errC } = await sb
    .from("counselors").select("id, semester, name, created_by").eq("id", currentCounselor.id).maybeSingle();
  if (errC || !counselor) {
    panelsEl.innerHTML = '<div class="empty-tip">导员不存在或已删除</div>';
    return;
  }
  const { data: ratings, error: errR } = await sb
    .from("counselor_ratings").select("id, counselor_id, student_id, score, comment, image_url, created_at, updated_at")
    .eq("counselor_id", counselor.id).order("created_at", { ascending: true });
  if (errR) {
    panelsEl.innerHTML = `<div class="empty-tip">加载失败：${escapeHtml(errR.message)}</div>`;
    return;
  }
  const item = { ...counselor, ratings: ratings || [] };
  const n = item.ratings.length;
  item.avg = n ? item.ratings.reduce((s, r) => s + r.score, 0) / n : null;
  item.myRating = item.ratings.find((r) => r.student_id === currentUser.student_id) || null;
  currentCounselor = item;
  renderPanels(panelsEl, [item], "counselor");
}

function goBackFromCounselor() {
  stopRealtime();
  $("#page-counselor").hidden = true;
  $("#page-course").hidden = true;
  $("#page-counselors").hidden = false;
  $("#page-semester").hidden = true;
  currentCounselor = null;
  renderCounselorGrid();
  subscribeRealtime();
}

// ============================================================
// 课程详情页
// ============================================================
async function openCourse(course) {
  currentCourse = course;
  currentCounselor = null;
  $("#page-semester").hidden = true;
  $("#page-counselors").hidden = true;
  $("#page-course").hidden = false;
  $("#course-title").textContent = `${course.name}`;
  $("#course-meta").textContent = `课程编号 ${course.id} · ${SEMESTERS[currentSemester].emoji} ${SEMESTERS[currentSemester].name} · 实时同步已开启`;
  $("#teacher-panels").innerHTML = '<div class="empty-tip">加载中…</div>';
  await loadTeachers();
  subscribeRealtime();
}

function goBackToSemester() {
  stopRealtime();
  $("#page-course").hidden = true;
  $("#page-counselor").hidden = true;
  $("#page-counselors").hidden = true;
  $("#page-semester").hidden = false;
  currentCourse = null;
  currentCounselor = null;
  subscribeRealtime();
}

async function loadTeachers() {
  const panelsEl = $("#teacher-panels");
  const cid = currentCourse.id;

  // 拉取该课程编号下的所有老师
  const { data: teachers, error: errT } = await sb
    .from("teachers").select("id, course_id, name, created_by").eq("course_id", cid).order("created_at");
  if (errT) {
    panelsEl.innerHTML = `<div class="empty-tip">加载失败：${escapeHtml(errT.message)}</div>`;
    return;
  }

  // 拉取所有相关评分
  const teacherIds = teachers.map((t) => t.id);
  let ratings = [];
  if (teacherIds.length) {
    const { data, error: errR } = await sb
      .from("ratings").select("id, teacher_id, student_id, score, comment, created_at, updated_at")
      .in("teacher_id", teacherIds).order("created_at", { ascending: true });
    if (errR) {
      panelsEl.innerHTML = `<div class="empty-tip">加载失败：${escapeHtml(errR.message)}</div>`;
      return;
    }
    ratings = data || [];
  }

  // 组装
  teachersCache = teachers.map((t) => ({
    ...t,
    ratings: ratings.filter((r) => r.teacher_id === t.id),
  }));
  teachersCache.forEach((t) => {
    const n = t.ratings.length;
    t.avg = n ? t.ratings.reduce((s, r) => s + r.score, 0) / n : null;
    t.myRating = t.ratings.find((r) => r.student_id === currentUser.student_id) || null;
  });

  renderTeacherPanels();
}

function renderPanels(panelsEl, items, kind) {
  captureDrafts(); // 先存草稿，防止重建时丢失输入
  if (!items.length) {
    const tip = kind === "counselor"
      ? '<div class="empty-tip">该导员暂无评价<br>来写第一条评价吧</div>'
      : '<div class="empty-tip">这门课还没有老师面板<br>点击右上角「＋ 添加老师」创建第一个评价面板</div>';
    panelsEl.innerHTML = tip;
    return;
  }
  panelsEl.innerHTML = "";
  items.forEach((item) => {
    panelsEl.appendChild(buildRatingPanel(item, kind));
  });
}

function renderTeacherPanels() {
  renderPanels($("#teacher-panels"), teachersCache, "teacher");
}

function buildRatingPanel(item, kind) {
  const panel = document.createElement("div");
  panel.className = "teacher-panel";
  panel.dataset.itemId = item.id;

  const avgText = item.avg !== null ? item.avg.toFixed(1) : "—";
  const avgColor = avgColorOf(item.avg);
  const ratingCount = item.ratings.length;
  const isCounselor = kind === "counselor";

  let ratingsHtml = "";
  if (!ratingCount) {
    ratingsHtml = '<div class="no-ratings">暂无评价，来做第一个评价的人吧</div>';
  } else {
    ratingsHtml = item.ratings.map((r) => {
      const badgeColor = scoreColorOf(r.score);
      const time = formatTime(r.updated_at || r.created_at);
      const comment = r.comment.trim()
        ? `<div class="rating-comment">${escapeHtml(r.comment)}</div>`
        : `<div class="rating-comment empty">（未留言）</div>`;
      const img = r.image_url
        ? `<img class="rating-img" src="${escapeHtml(r.image_url)}" alt="评价配图" loading="lazy" onclick="viewImage('${escapeHtml(r.image_url)}')" />`
        : "";
      return `
        <div class="rating-item">
          <div class="rating-user">${escapeHtml(r.student_id).slice(-2)}</div>
          <div class="rating-body">
            <div class="rating-top">
              <span class="rating-student-id">${escapeHtml(r.student_id)}</span>
              <span class="rating-score-badge" style="background:${badgeColor}">${r.score} 分</span>
              <span class="rating-time">${time}</span>
            </div>
            ${comment}
            ${img}
          </div>
        </div>`;
    }).join("");
  }

  const my = item.myRating;
  const draft = draftCache[item.id];
  const myScore = draft ? draft.score : (my ? my.score : 5);
  const canDeleteItem = item.created_by && item.created_by === currentUser.student_id;

  panel.innerHTML = `
    <div class="teacher-head">
      <div class="teacher-avatar">${escapeHtml(item.name.charAt(0))}</div>
      <div class="teacher-info">
        <div class="teacher-name">${escapeHtml(item.name)}</div>
        <div class="teacher-stats">${ratingCount} 条评价${canDeleteItem ? " · 我添加的" : ""}</div>
      </div>
      <div class="avg-box">
        <div class="avg-num" style="color:${avgColor}">${avgText}</div>
        <div class="avg-label">平均分 / 10</div>
      </div>
      ${canDeleteItem ? `<button class="btn btn-danger btn-del-item">删除${isCounselor ? "导员" : ""}</button>` : ""}
    </div>
    <div class="ratings-list">${ratingsHtml}</div>
    <div class="rate-box">
      <div class="rate-title">
        ${my ? "修改我的评分" : "我来评分"}
        ${my ? `<span class="my-score">（当前 ${my.score} 分${my.comment ? "，已留言" : "，未留言"}${my.image_url ? "，有配图" : ""}）</span>` : ""}
      </div>
      <div class="score-row">
        <input type="range" min="0" max="10" step="1" value="${myScore}" class="score-slider" />
        <div class="score-value">${myScore}.0</div>
      </div>
      <textarea class="rate-comment" maxlength="500" placeholder="留言（可选，将展示在评价面板上）">${escapeHtml(draft ? draft.comment : (my ? my.comment : ""))}</textarea>
      ${isCounselor ? `
      <div class="img-upload-row">
        <label class="btn btn-ghost btn-upload">📷 上传图片（可选）
          <input type="file" accept="image/*" class="file-input" hidden />
        </label>
        <span class="upload-hint">jpg/png，自动压缩，点击图片可查看大图</span>
        <div class="img-preview" ${my && my.image_url ? "" : "hidden"}>
          <img src="${my && my.image_url ? escapeHtml(my.image_url) : ""}" alt="预览" />
          <button type="button" class="img-remove" title="移除本次选择的图片">✕</button>
        </div>
      </div>` : ""}
      <div class="rate-actions">
        ${my ? `<button class="btn btn-danger btn-del-rating">删除我的评价</button>` : ""}
        <button class="btn btn-primary btn-submit-rate">${my ? "更新评分" : "提交评分"}</button>
      </div>
    </div>`;

  // 滑块联动
  const slider = panel.querySelector(".score-slider");
  const scoreVal = panel.querySelector(".score-value");
  slider.addEventListener("input", () => {
    scoreVal.textContent = Number(slider.value).toFixed(1);
  });

  // 图片选择（仅导员评价）
  let selectedFile = null;
  const fileInput = panel.querySelector(".file-input");
  const previewBox = panel.querySelector(".img-preview");
  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files[0];
      if (!f) return;
      if (f.size > 15 * 1024 * 1024) {
        alert("图片过大（超过 15MB），请压缩后再传");
        fileInput.value = "";
        return;
      }
      try {
        selectedFile = await resizeImage(f);
        previewBox.querySelector("img").src = URL.createObjectURL(selectedFile);
        previewBox.hidden = false;
      } catch (e) {
        alert("图片处理失败：" + e.message);
        fileInput.value = "";
      }
    });
    previewBox.querySelector(".img-remove").addEventListener("click", () => {
      selectedFile = null;
      fileInput.value = "";
      if (my && my.image_url) {
        // 已有配图时点击 ✕ 仅撤销本次选择，原图保留
        previewBox.querySelector("img").src = my.image_url;
        previewBox.hidden = false;
      } else {
        previewBox.hidden = true;
      }
    });
  }

  // 提交评分
  const btnSubmit = panel.querySelector(".btn-submit-rate");
  btnSubmit.addEventListener("click", () => {
    btnSubmit.disabled = true;
    submitRating(kind, item.id, Number(slider.value), panel.querySelector(".rate-comment").value.trim(), selectedFile)
      .finally(() => { btnSubmit.disabled = false; });
  });

  // 删除自己的评价（仅已评分的显示）
  const btnDelRating = panel.querySelector(".btn-del-rating");
  if (btnDelRating) btnDelRating.addEventListener("click", () => deleteMyRating(kind, item.id));

  // 删除老师/导员（仅添加者显示）
  const btnDelItem = panel.querySelector(".btn-del-item");
  if (btnDelItem) btnDelItem.addEventListener("click", () => deleteItem(kind, item.id));

  // 失焦时若有待处理的刷新，执行它（用户在打字期间刷新已被暂缓）
  const ta = panel.querySelector(".rate-comment");
  if (ta) {
    ta.addEventListener("blur", () => {
      if (pendingReload) {
        pendingReload = false;
        reloadCurrent();
      }
    });
  }

  return panel;
}

// ============================================================
// 评分提交（同一学生同一对象：有则更新，无则插入）
// kind: teacher | counselor；file: 导员评价可选配图
// ============================================================
async function submitRating(kind, itemId, score, comment, file) {
  const sid = currentUser.student_id;
  const isCounselor = kind === "counselor";
  const table = isCounselor ? "counselor_ratings" : "ratings";
  const fk = isCounselor ? "counselor_id" : "teacher_id";
  const cache = isCounselor ? counselorsCache : teachersCache;
  const my = cache.find((x) => x.id === itemId)?.myRating;
  let imageUrl = my ? my.image_url : null;

  // 有配图则先上传（已自动压缩）
  if (file) {
    try {
      imageUrl = await uploadCounselorImage(file, itemId);
      // 覆盖旧图时顺带清理旧文件（尽力而为）
      if (my && my.image_url && my.image_url !== imageUrl) deleteStoredImage(my.image_url);
    } catch (e) {
      alert("图片上传失败：" + e.message + "\n（请确认已在 SQL Editor 执行建表和 Storage 策略）");
      return;
    }
  }

  let error = null;
  if (my) {
    ({ error } = await sb
      .from(table)
      .update({ score, comment, image_url: imageUrl, updated_at: new Date().toISOString() })
      .eq("id", my.id));
  } else {
    const row = { [fk]: itemId, student_id: sid, score, comment };
    if (imageUrl) row.image_url = imageUrl;
    ({ error } = await sb.from(table).insert(row));
  }

  if (error) {
    alert("提交失败：" + error.message);
    return;
  }
  await reloadCurrent(); // 刷新当前视图
}

// ============================================================
// 添加老师 / 导员（同一个弹窗，按 addTarget 区分）
// ============================================================
function openAddItemModal(target) {
  addTarget = target;
  const idInput = $("#new-item-id");
  if (target === "course") {
    $("#add-item-title").textContent = "添加课程";
    $("#add-item-desc").textContent = "输入课程名称与课程编号（编号为纯数字）。添加后会与内置课程一起展示，可正常添加老师并评价。";
    $("#new-item-name").placeholder = "课程名称（如：大学语文）";
    $("#new-item-name").maxLength = 50;
    $("#new-item-name").value = "";
    idInput.hidden = false;
    idInput.value = "";
    $("#add-item-msg").textContent = "";
    $("#modal-add-item").hidden = false;
    $("#new-item-name").focus();
    return;
  }
  idInput.hidden = true;
  const isCounselor = target === "counselor";
  $("#add-item-title").textContent = isCounselor ? "添加导员" : "添加老师";
  $("#add-item-desc").textContent = isCounselor
    ? "输入导员姓名（如：王导）。导员板块面向全体同学，可评分、留言、上传图片。"
    : "输入为这门课授课的老师姓名（同一课程编号可能有多位老师）";
  $("#new-item-name").placeholder = isCounselor ? "导员姓名" : "老师姓名";
  $("#new-item-name").maxLength = 30;
  $("#new-item-name").value = "";
  $("#add-item-msg").textContent = "";
  $("#modal-add-item").hidden = false;
  $("#new-item-name").focus();
}

function closeAddItemModal() {
  $("#modal-add-item").hidden = true;
}

async function confirmAddItem() {
  const name = $("#new-item-name").value.trim();
  const msgEl = $("#add-item-msg");
  if (!name) return showMsg(msgEl, "请输入名称", "err");
  if (name.length > 50) return showMsg(msgEl, "名称过长（最多 50 字）", "err");

  if (addTarget === "course") {
    const cid = $("#new-item-id").value.trim();
    if (!/^\d{4,12}$/.test(cid)) return showMsg(msgEl, "课程编号应为 4~12 位纯数字", "err");
    // 内置课程已存在
    const builtin = (COURSES[currentSemester] || []).find((c) => c.id === cid);
    if (builtin) return showMsg(msgEl, `该课程编号已在内置列表中（${builtin.name}），无需添加`, "err");
    // 同学已添加过
    const { data: exist } = await sb
      .from("custom_courses").select("id").eq("semester", currentSemester).eq("course_id", cid).maybeSingle();
    if (exist) return showMsg(msgEl, "这门课已经被添加过了", "err");
    const { error } = await sb
      .from("custom_courses").insert({ semester: currentSemester, course_id: cid, name, created_by: currentUser.student_id });
    if (error) return showMsg(msgEl, "添加失败：" + error.message, "err");
    closeAddItemModal();
    renderCourseGrid();
    return;
  }

  if (addTarget === "counselor") {
    // 同名导员不重复添加（导员为全局板块，不区分学期）
    const { data: exist } = await sb
      .from("counselors").select("id").eq("name", name).maybeSingle();
    if (exist) return showMsg(msgEl, "这位导员已存在，无需重复添加", "err");
    const { error } = await sb
      .from("counselors").insert({ semester: "", name, created_by: currentUser.student_id });
    if (error) return showMsg(msgEl, "添加失败：" + error.message, "err");
    closeAddItemModal();
    renderCounselorGrid();
    return;
  }

  // 老师：同课程编号下同名不重复添加
  const { data: exist } = await sb
    .from("teachers").select("id").eq("course_id", currentCourse.id).eq("name", name).maybeSingle();
  if (exist) return showMsg(msgEl, "这位老师已存在，无需重复添加", "err");

  const { error } = await sb
    .from("teachers").insert({ course_id: currentCourse.id, name, created_by: currentUser.student_id });
  if (error) return showMsg(msgEl, "添加失败：" + error.message, "err");

  closeAddItemModal();
  await loadTeachers();
}

// ============================================================
// 实时同步（Supabase Realtime）
// 别人添加 / 评分 / 删除后，当前页面自动刷新数据，无需手动刷新
// ============================================================
function stopRealtime() {
  if (realtimeChannel) {
    sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

// 按当前视图刷新数据
function reloadCurrent() {
  if (currentCounselor) loadCounselorDetail();
  else if (currentCourse) loadTeachers();
  else if (currentSemester === "counselor") renderCounselorGrid();
  else renderCourseGrid();
}

function scheduleReload() {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    if (isUserTyping()) {
      // 用户正在写评论：暂缓刷新，等他失焦再刷，避免输入被重建清掉
      pendingReload = true;
      return;
    }
    pendingReload = false;
    reloadCurrent();
  }, 400);
}

function isUserTyping() {
  const el = document.activeElement;
  return !!(el && el.classList && el.classList.contains("rate-comment"));
}

// 保存所有面板输入中的草稿（评论文字 + 滑块值），重渲染后恢复
function captureDrafts() {
  draftCache = {};
  document.querySelectorAll(".teacher-panel").forEach((panel) => {
    const id = panel.dataset.itemId;
    const ta = panel.querySelector(".rate-comment");
    const sl = panel.querySelector(".score-slider");
    if (!ta && !sl) return;
    draftCache[id] = {
      comment: ta ? ta.value : "",
      score: sl ? Number(sl.value) : null,
    };
  });
}

// 根据当前所处页面订阅相应事件
function subscribeRealtime() {
  stopRealtime();

  // 课程详情页：该课程的老师 + 所有评分
  if (currentCourse) {
    const cid = currentCourse.id;
    realtimeChannel = sb
      .channel("course-realtime-" + cid)
      .on("postgres_changes", { event: "*", schema: "public", table: "teachers" }, (payload) => {
        const t = payload.new || payload.old;
        if (t && t.course_id === cid) scheduleReload();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "ratings" }, () => {
        scheduleReload();
      })
      .subscribe();
    return;
  }

  // 导员详情页：该导员的评分 + 导员本身的增删
  if (currentCounselor) {
    const cid = currentCounselor.id;
    realtimeChannel = sb
      .channel("counselor-realtime-" + cid)
      .on("postgres_changes", { event: "*", schema: "public", table: "counselors" }, (payload) => {
        const c = payload.new || payload.old;
        if (c && c.id === cid) {
          if (payload.eventType === "DELETE") {
            alert("该导员已被添加者删除，返回学期页");
            goBackFromCounselor();
          } else {
            scheduleReload();
          }
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "counselor_ratings" }, (payload) => {
        const r = payload.new || payload.old;
        if (r && r.counselor_id === cid) scheduleReload();
      })
      .subscribe();
    return;
  }

  // 导员列表页：全部导员的增删 + 全部导员评分（刷新卡片平均分）
  if (currentSemester === "counselor") {
    realtimeChannel = sb
      .channel("counselors-list-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "counselors" }, () => {
        scheduleReload();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "counselor_ratings" }, () => {
        scheduleReload();
      })
      .subscribe();
    return;
  }

  // 学期页：订阅同学自建课程的增删（课程列表为静态+自建动态）
  const sem = currentSemester;
  realtimeChannel = sb
    .channel("semester-realtime-" + sem)
    .on("postgres_changes", { event: "*", schema: "public", table: "custom_courses" }, (payload) => {
      const c = payload.new || payload.old;
      if (c && c.semester === sem) scheduleReload();
    })
    .subscribe();
}

// ============================================================
// 删除功能
// 1) 学生删除自己的评价（评分+留言+配图一起删）
// 2) 添加者删除老师/导员（其下所有评价级联删除）
// ============================================================
async function deleteMyRating(kind, itemId) {
  const isCounselor = kind === "counselor";
  const table = isCounselor ? "counselor_ratings" : "ratings";
  const cache = isCounselor ? counselorsCache : teachersCache;
  const my = cache.find((x) => x.id === itemId)?.myRating;
  if (!my) return;
  if (!confirm(`确定删除你对这位${isCounselor ? "导员" : "老师"}的评价吗？删除后不可恢复。`)) return;
  const { error } = await sb.from(table).delete().eq("id", my.id);
  if (error) {
    alert("删除失败：" + error.message);
    return;
  }
  if (my.image_url) deleteStoredImage(my.image_url); // 尽力清理配图
  await reloadCurrent();
}

async function deleteItem(kind, itemId) {
  const isCounselor = kind === "counselor";
  const table = isCounselor ? "counselors" : "teachers";
  const cache = isCounselor ? counselorsCache : teachersCache;
  const item = cache.find((x) => x.id === itemId);
  if (!item) return;
  const count = item.ratings.length;
  const label = isCounselor ? "导员" : "老师";
  if (!confirm(`确定删除${label}「${item.name}」吗？${count ? `其下 ${count} 条评价将一并删除，` : ""}删除后不可恢复。`)) return;
  const { error } = await sb.from(table).delete().eq("id", itemId);
  if (error) {
    alert("删除失败：" + error.message);
    return;
  }
  // 清理该导员名下全部配图（尽力而为）
  if (isCounselor) item.ratings.forEach((r) => { if (r.image_url) deleteStoredImage(r.image_url); });
  await reloadCurrent();
}

// 3) 自建课程的添加者删除课程
async function deleteCustomCourse(course) {
  if (!confirm(`确定删除课程「${course.name}」（编号 ${course.id}）吗？删除后不可恢复。`)) return;

  // 1) 删除课程记录
  const { error } = await sb.from("custom_courses").delete().eq("id", course.customId);
  if (error) {
    alert("删除失败：" + error.message);
    return;
  }

  // 2) 判断该编号是否被其他课程共用（内置列表或其余学期的自建课程）
  const builtinShared = Object.values(COURSES).some((list) => list.some((c) => c.id === course.id));
  let customShared = false;
  if (!builtinShared) {
    const { data: others } = await sb
      .from("custom_courses").select("id").neq("id", course.customId).eq("course_id", course.id);
    customShared = !!(others && others.length);
  }

  // 3) 无共用时才级联删除该编号下的老师（其评分随外键级联删除）
  if (!builtinShared && !customShared) {
    await sb.from("teachers").delete().eq("course_id", course.id);
  }

  renderCourseGrid();
}

// ============================================================
// 图片上传（导员评价配图，Supabase Storage）
// ============================================================
const IMG_BUCKET = "counselor-images";

// 客户端压缩：最长边限制 1280px，JPEG 质量 0.82
function resizeImage(file, maxSize = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(new File([blob], "counselor-img.jpg", { type: "image/jpeg" }));
          else resolve(file);
        }, "image/jpeg", quality);
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("无法解析该图片")); };
    img.src = url;
  });
}

async function uploadCounselorImage(file, counselorId) {
  const path = `${counselorId}/${currentUser.student_id}_${Date.now()}.jpg`;
  const { error } = await sb.storage.from(IMG_BUCKET).upload(path, file, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return sb.storage.from(IMG_BUCKET).getPublicUrl(path).data.publicUrl;
}

// 根据公开 URL 删除存储文件（尽力而为，失败不阻塞主流程）
async function deleteStoredImage(publicUrl) {
  try {
    const marker = `/object/public/${IMG_BUCKET}/`;
    const idx = publicUrl.indexOf(marker);
    if (idx < 0) return;
    const path = publicUrl.slice(idx + marker.length);
    await sb.storage.from(IMG_BUCKET).remove([path]);
  } catch (e) { /* 忽略 */ }
}

// 点击查看大图
function viewImage(url) {
  window.open(url, "_blank");
}

// ============================================================
// 工具函数
// ============================================================
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function scoreColorOf(score) {
  if (score >= 9) return "#1e8e5a";
  if (score >= 7) return "#2e86c1";
  if (score >= 5) return "#e8a13c";
  return "#c0392b";
}

function avgColorOf(avg) {
  if (avg === null) return "#b6aebb";
  if (avg >= 8) return "#1e8e5a";
  if (avg >= 6) return "#2e86c1";
  if (avg >= 4) return "#e8a13c";
  return "#c0392b";
}

// ============================================================
// 事件绑定 & 初始化
// ============================================================
// 全局错误提示（脚本出错时在页面底部显示，方便排查）
window.addEventListener("error", (e) => {
  let el = document.getElementById("boot-error");
  if (!el) {
    el = document.createElement("div");
    el.id = "boot-error";
    el.style.cssText = "position:fixed;left:0;right:0;bottom:0;background:#c0392b;color:#fff;padding:10px 16px;font-size:13px;z-index:9999;font-family:sans-serif;";
    document.body.appendChild(el);
  }
  el.textContent = "⚠️ 页面出错：" + e.message;
});

function bindEvents() {
  // 登录/注册 tab 切换
  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const mode = tab.dataset.authTab;
      $("#form-login").hidden = mode !== "login";
      $("#form-register").hidden = mode !== "register";
      $("#auth-msg").textContent = "";
    });
  });

  $("#form-login").addEventListener("submit", handleLogin);
  $("#form-register").addEventListener("submit", handleRegister);
  $("#btn-logout").addEventListener("click", handleLogout);
  $("#btn-back").addEventListener("click", goBackToSemester);
  $("#btn-back-c").addEventListener("click", goBackFromCounselor);
  $("#btn-add-teacher").addEventListener("click", () => openAddItemModal("teacher"));
  $("#btn-add-course").addEventListener("click", () => openAddItemModal("course"));
  $("#btn-add-counselor").addEventListener("click", () => openAddItemModal("counselor"));
  $("#btn-cancel-add").addEventListener("click", closeAddItemModal);
  $("#btn-confirm-add").addEventListener("click", confirmAddItem);
  $("#new-item-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmAddItem();
  });
  // 点击遮罩关闭弹窗
  $("#modal-add-item").addEventListener("click", (e) => {
    if (e.target.id === "modal-add-item") closeAddItemModal();
  });
}

async function init() {
  bindEvents();
  // 恢复登录态
  const saved = localStorage.getItem(SESSION_KEY);
  if (saved) {
    const { data } = await sb
      .from("users").select("student_id").eq("student_id", saved).maybeSingle();
    if (data) {
      enterApp(saved);
      return;
    }
    localStorage.removeItem(SESSION_KEY);
  }
  viewAuth.hidden = false;
}

init();
