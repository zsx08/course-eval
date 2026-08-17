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
let teachersCache = [];        // [{ id, course_id, name, ratings: [...], avg }]
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
  stopCourseRealtime();
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
}

function switchSemester(key) {
  currentSemester = key;
  document.querySelectorAll(".sem-tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.sem === key));
  renderCourseGrid();
}

function renderCourseGrid() {
  const grid = $("#course-grid");
  grid.innerHTML = "";
  const list = COURSES[currentSemester];
  if (!list || !list.length) {
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
    card.className = "course-card";
    const first = group[0];
    card.innerHTML = `
      <span class="course-id">${first.id}</span>
      <div class="course-name">${first.name}</div>
      <div class="course-num"><span class="dot">●</span> 点击查看老师评价</div>`;
    card.addEventListener("click", () => openCourse(first));
    grid.appendChild(card);
  });
}

// ============================================================
// 课程详情页
// ============================================================
async function openCourse(course) {
  currentCourse = course;
  $("#page-semester").hidden = true;
  $("#page-course").hidden = false;
  $("#course-title").textContent = `${course.name}`;
  $("#course-meta").textContent = `课程编号 ${course.id} · ${SEMESTERS[currentSemester].emoji} ${SEMESTERS[currentSemester].name} · 实时同步已开启`;
  $("#teacher-panels").innerHTML = '<div class="empty-tip">加载中…</div>';
  await loadTeachers();
  subscribeCourseRealtime();
}

function goBackToSemester() {
  stopCourseRealtime();
  $("#page-course").hidden = true;
  $("#page-semester").hidden = false;
  currentCourse = null;
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

function renderTeacherPanels() {
  captureDrafts(); // 先存草稿，防止重建时丢失输入
  const panelsEl = $("#teacher-panels");
  if (!teachersCache.length) {
    panelsEl.innerHTML = `
      <div class="empty-tip">这门课还没有老师面板<br>点击右上角「＋ 添加老师」创建第一个评价面板</div>`;
    return;
  }
  panelsEl.innerHTML = "";
  teachersCache.forEach((t, idx) => {
    panelsEl.appendChild(buildTeacherPanel(t, idx));
  });
}

function buildTeacherPanel(t, idx) {
  const panel = document.createElement("div");
  panel.className = "teacher-panel";
  panel.dataset.teacherId = t.id;

  const avgText = t.avg !== null ? t.avg.toFixed(1) : "—";
  const avgColor = avgColorOf(t.avg);
  const ratingCount = t.ratings.length;

  let ratingsHtml = "";
  if (!ratingCount) {
    ratingsHtml = '<div class="no-ratings">暂无评价，来做第一个评价的人吧</div>';
  } else {
    ratingsHtml = t.ratings.map((r) => {
      const badgeColor = scoreColorOf(r.score);
      const time = formatTime(r.updated_at || r.created_at);
      const comment = r.comment.trim()
        ? `<div class="rating-comment">${escapeHtml(r.comment)}</div>`
        : `<div class="rating-comment empty">（未留言）</div>`;
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
          </div>
        </div>`;
    }).join("");
  }

  const my = t.myRating;
  const draft = draftCache[t.id];
  const myScore = draft ? draft.score : (my ? my.score : 5);
  const canDeleteTeacher = t.created_by && t.created_by === currentUser.student_id;

  panel.innerHTML = `
    <div class="teacher-head">
      <div class="teacher-avatar">${escapeHtml(t.name.charAt(0))}</div>
      <div class="teacher-info">
        <div class="teacher-name">${escapeHtml(t.name)}</div>
        <div class="teacher-stats">${ratingCount} 条评价${canDeleteTeacher ? " · 我添加的" : ""}</div>
      </div>
      <div class="avg-box">
        <div class="avg-num" style="color:${avgColor}">${avgText}</div>
        <div class="avg-label">平均分 / 10</div>
      </div>
      ${canDeleteTeacher ? `<button class="btn btn-danger btn-del-teacher">删除</button>` : ""}
    </div>
    <div class="ratings-list">${ratingsHtml}</div>
    <div class="rate-box">
      <div class="rate-title">
        ${my ? "修改我的评分" : "我来评分"}
        ${my ? `<span class="my-score">（当前 ${my.score} 分${my.comment ? "，已留言" : "，未留言"}）</span>` : ""}
      </div>
      <div class="score-row">
        <input type="range" min="0" max="10" step="1" value="${myScore}" class="score-slider" />
        <div class="score-value">${myScore}.0</div>
      </div>
      <textarea class="rate-comment" maxlength="500" placeholder="留言（可选，将展示在评价面板上）">${escapeHtml(draft ? draft.comment : (my ? my.comment : ""))}</textarea>
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

  // 提交评分
  const btnSubmit = panel.querySelector(".btn-submit-rate");
  btnSubmit.addEventListener("click", () => submitRating(t.id, Number(slider.value), panel.querySelector(".rate-comment").value.trim()));

  // 删除自己的评价（仅已评分的显示）
  const btnDelRating = panel.querySelector(".btn-del-rating");
  if (btnDelRating) btnDelRating.addEventListener("click", () => deleteMyRating(t.id));

  // 删除老师（仅添加者显示）
  const btnDelTeacher = panel.querySelector(".btn-del-teacher");
  if (btnDelTeacher) btnDelTeacher.addEventListener("click", () => deleteTeacher(t.id));

  // 失焦时若有待处理的刷新，执行它（用户在打字期间刷新已被暂缓）
  const ta = panel.querySelector(".rate-comment");
  if (ta) {
    ta.addEventListener("blur", () => {
      if (pendingReload) {
        pendingReload = false;
        loadTeachers();
      }
    });
  }

  return panel;
}

// ============================================================
// 评分提交（同一学生同一老师：有则更新，无则插入）
// ============================================================
async function submitRating(teacherId, score, comment) {
  const sid = currentUser.student_id;
  const my = teachersCache.find((t) => t.id === teacherId)?.myRating;
  let error = null;

  if (my) {
    ({ error } = await sb
      .from("ratings")
      .update({ score, comment, updated_at: new Date().toISOString() })
      .eq("id", my.id));
  } else {
    ({ error } = await sb
      .from("ratings")
      .insert({ teacher_id: teacherId, student_id: sid, score, comment }));
  }

  if (error) {
    alert("提交失败：" + error.message);
    return;
  }
  await loadTeachers(); // 刷新面板
}

// ============================================================
// 添加老师
// ============================================================
function openAddTeacherModal() {
  $("#new-teacher-name").value = "";
  $("#add-teacher-msg").textContent = "";
  $("#modal-add-teacher").hidden = false;
  $("#new-teacher-name").focus();
}

function closeAddTeacherModal() {
  $("#modal-add-teacher").hidden = true;
}

async function confirmAddTeacher() {
  const name = $("#new-teacher-name").value.trim();
  const msgEl = $("#add-teacher-msg");
  if (!name) return showMsg(msgEl, "请输入老师姓名", "err");
  if (name.length > 30) return showMsg(msgEl, "姓名过长（最多 30 字）", "err");

  // 同名老师不重复添加
  const { data: exist } = await sb
    .from("teachers").select("id").eq("course_id", currentCourse.id).eq("name", name).maybeSingle();
  if (exist) return showMsg(msgEl, "这位老师已存在，无需重复添加", "err");

  const { error } = await sb
    .from("teachers").insert({ course_id: currentCourse.id, name, created_by: currentUser.student_id });
  if (error) return showMsg(msgEl, "添加失败：" + error.message, "err");

  closeAddTeacherModal();
  await loadTeachers();
}

// ============================================================
// 实时同步（Supabase Realtime）
// 别人添加老师 / 评分 / 改分后，当前页面自动刷新数据，无需手动刷新
// ============================================================
function stopCourseRealtime() {
  if (realtimeChannel) {
    sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
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
    loadTeachers();
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
    const id = panel.dataset.teacherId;
    const ta = panel.querySelector(".rate-comment");
    const sl = panel.querySelector(".score-slider");
    if (!ta && !sl) return;
    draftCache[id] = {
      comment: ta ? ta.value : "",
      score: sl ? Number(sl.value) : null,
    };
  });
}

function subscribeCourseRealtime() {
  stopCourseRealtime();
  const cid = currentCourse.id;
  realtimeChannel = sb
    .channel("course-realtime-" + cid)
    // 有人添加/删除当前课程的老师
    .on("postgres_changes", { event: "*", schema: "public", table: "teachers" }, (payload) => {
      const t = payload.new || payload.old;
      if (t && t.course_id === cid) scheduleReload();
    })
    // 有人评分 / 改分 / 删评
    .on("postgres_changes", { event: "*", schema: "public", table: "ratings" }, () => {
      scheduleReload();
    })
    .subscribe();
}

// ============================================================
// 删除功能
// 1) 学生删除自己对某位老师的评价（评分+留言一起删）
// 2) 添加老师的人删除该老师（其下所有评价级联删除）
// ============================================================
async function deleteMyRating(teacherId) {
  const my = teachersCache.find((t) => t.id === teacherId)?.myRating;
  if (!my) return;
  if (!confirm("确定删除你对这位老师的评价吗？删除后不可恢复。")) return;
  const { error } = await sb.from("ratings").delete().eq("id", my.id);
  if (error) {
    alert("删除失败：" + error.message);
    return;
  }
  await loadTeachers();
}

async function deleteTeacher(teacherId) {
  const t = teachersCache.find((x) => x.id === teacherId);
  if (!t) return;
  const count = t.ratings.length;
  if (!confirm(`确定删除老师「${t.name}」吗？${count ? `其下 ${count} 条评价将一并删除，` : ""}删除后不可恢复。`)) return;
  const { error } = await sb.from("teachers").delete().eq("id", teacherId);
  if (error) {
    alert("删除失败：" + error.message);
    return;
  }
  await loadTeachers();
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
  $("#btn-add-teacher").addEventListener("click", openAddTeacherModal);
  $("#btn-cancel-add").addEventListener("click", closeAddTeacherModal);
  $("#btn-confirm-add").addEventListener("click", confirmAddTeacher);
  $("#new-teacher-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmAddTeacher();
  });
  // 点击遮罩关闭弹窗
  $("#modal-add-teacher").addEventListener("click", (e) => {
    if (e.target.id === "modal-add-teacher") closeAddTeacherModal();
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
