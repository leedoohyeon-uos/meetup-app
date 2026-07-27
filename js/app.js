// ============================================================
// app.js — SPA 라우터 + 화면 렌더링
// 해시 라우트:
//   #/                    시작 화면 (등록 여부에 따라 자동 분기)
//   #/register            이름/생년월일 등록
//   #/group               그룹 참여 / 생성 홈
//   #/create              약속 생성 폼
//   #/schedule/{groupId}  일정 입력 (마감 전) / 결과 (마감 후) 자동 분기
//   #/invite/{code}       초대 링크 진입점
// ============================================================

import { authReady } from "./firebase-config.js";
import * as db from "./db.js";
import {
  sha256,
  makeUserKey,
  isValidBirth6,
  toDateKey,
  buildTimeSlots,
  nextStatus,
  percentToColor,
  formatRemaining,
  escapeHtml,
} from "./utils.js";

const root = document.getElementById("view-root");
const userTag = document.getElementById("current-user-tag");

// ---------------- 로컬 사용자 세션 ----------------
function getCurrentUser() {
  const raw = localStorage.getItem("meetup_user");
  return raw ? JSON.parse(raw) : null;
}
function setCurrentUser(user) {
  localStorage.setItem("meetup_user", JSON.stringify(user));
  renderUserTag();
}
function renderUserTag() {
  const u = getCurrentUser();
  userTag.textContent = u ? `${u.name}님으로 접속 중 · ` + u.userKey.slice(-6) : "";
}

// ---------------- 라우터 ----------------
function navigate(hash) {
  location.hash = hash;
}
window.addEventListener("hashchange", route);
document.querySelector(".brand").addEventListener("click", () => navigate("#/"));
document.getElementById("help-btn").addEventListener("click", () => toggleHelp(true));
document.getElementById("help-close").addEventListener("click", () => toggleHelp(false));
document.getElementById("help-modal").addEventListener("click", (e) => {
  if (e.target.id === "help-modal") toggleHelp(false);
});
function toggleHelp(show) {
  document.getElementById("help-modal").classList.toggle("hidden", !show);
}

async function route() {
  await authReady; // Firestore 규칙이 인증을 요구하므로 항상 먼저 대기
  renderUserTag();

  const hash = location.hash || "#/";
  const [, path, param] = hash.match(/^#\/([^\/]*)\/?(.*)$/) || [];

  try {
    if (path === "invite") return viewInvite(param);
    if (path === "register") return viewRegister();
    if (path === "group") return requireUser(viewGroupHome);
    if (path === "create") return requireUser(viewCreateGroup);
    if (path === "schedule") return requireUser(() => viewSchedule(param));
    // 기본: 등록 여부로 분기
    return getCurrentUser() ? viewGroupHome() : viewRegister();
  } catch (err) {
    console.error(err);
    renderError(err.message || "알 수 없는 오류가 발생했습니다.");
  }
}

function requireUser(fn) {
  if (!getCurrentUser()) {
    sessionStorage.setItem("meetup_redirect", location.hash);
    navigate("#/register");
    return;
  }
  return fn();
}

function renderError(msg) {
  root.innerHTML = `
    <div class="card">
      <p class="eyebrow">오류</p>
      <h1 class="view-title">문제가 발생했어요</h1>
      <p class="view-sub">${escapeHtml(msg)}</p>
      <div class="actions-row">
        <button class="btn-secondary" id="err-home">처음으로</button>
      </div>
    </div>`;
  document.getElementById("err-home").onclick = () => navigate("#/");
}

// ============================================================
// 화면 1. 사용자 등록
// ============================================================
function viewRegister() {
  root.innerHTML = `
    <div class="card">
      <p class="eyebrow">Step 1</p>
      <h1 class="view-title">이름과 생년월일을 알려주세요</h1>
      <p class="view-sub">같은 이름이어도 생년월일로 구분되니 걱정 마세요. 이미 등록된 정보라면 새로 만들지 않고 불러와요.</p>

      <div class="field">
        <label for="in-name">이름</label>
        <input id="in-name" type="text" placeholder="예: 홍길동" maxlength="20" />
      </div>
      <div class="field">
        <label for="in-birth">생년월일 6자리</label>
        <input id="in-birth" type="text" placeholder="예: 991231 (YYMMDD)" maxlength="6" inputmode="numeric" />
        <div class="field-hint">숫자 6자리만 입력해주세요.</div>
      </div>
      <div id="reg-error" class="field-error" style="display:none;"></div>

      <div class="actions-row">
        <button class="btn-primary" id="reg-submit">시작하기</button>
      </div>
    </div>`;

  const submit = document.getElementById("reg-submit");
  submit.addEventListener("click", async () => {
    const name = document.getElementById("in-name").value.trim();
    const birth = document.getElementById("in-birth").value.trim();
    const errEl = document.getElementById("reg-error");
    errEl.style.display = "none";

    if (!name) return showErr("이름을 입력해주세요.");
    if (!isValidBirth6(birth)) return showErr("생년월일 6자리(YYMMDD)를 정확히 입력해주세요.");

    submit.disabled = true;
    submit.textContent = "확인 중...";
    try {
      const user = await db.findOrCreateUser(name, birth);
      setCurrentUser({ name: user.name, birth: user.birth, userKey: user.userKey });
      const redirect = sessionStorage.getItem("meetup_redirect");
      sessionStorage.removeItem("meetup_redirect");
      navigate(redirect || "#/group");
    } catch (e) {
      showErr("등록 중 오류가 발생했어요: " + e.message);
    } finally {
      submit.disabled = false;
      submit.textContent = "시작하기";
    }

    function showErr(msg) {
      errEl.textContent = msg;
      errEl.style.display = "block";
    }
  });
}

// ============================================================
// 화면 2. 그룹 홈 (참여 / 생성)
// ============================================================
function viewGroupHome() {
  root.innerHTML = `
    <div class="card">
      <p class="eyebrow">Step 2</p>
      <h1 class="view-title">약속에 참여하거나 새로 만들어보세요</h1>
      <p class="view-sub">참여할 약속의 이름과 비밀번호를 입력하세요.</p>

      <div class="field">
        <label for="join-name">약속 이름</label>
        <input id="join-name" type="text" placeholder="예: 동아리 MT 날짜 정하기" />
      </div>
      <div class="field">
        <label for="join-pw">비밀번호</label>
        <input id="join-pw" type="password" placeholder="약속 비밀번호" />
      </div>
      <div id="join-error" class="field-error" style="display:none;"></div>
      <div class="actions-row">
        <button class="btn-primary" id="join-submit">참여하기</button>
      </div>
    </div>

    <div class="divider-label">또는</div>

    <div class="card">
      <h1 class="view-title" style="font-size:19px;">새로운 약속 만들기</h1>
      <p class="view-sub">그룹원과 나눌 새 약속방을 만들어요.</p>
      <div class="actions-row" style="margin-top:0;">
        <button class="btn-secondary" id="go-create">약속 만들기</button>
      </div>
    </div>
  `;

  document.getElementById("go-create").onclick = () => navigate("#/create");

  document.getElementById("join-submit").addEventListener("click", async () => {
    const name = document.getElementById("join-name").value.trim();
    const pw = document.getElementById("join-pw").value;
    const errEl = document.getElementById("join-error");
    errEl.style.display = "none";

    if (!name || !pw) {
      errEl.textContent = "약속 이름과 비밀번호를 모두 입력해주세요.";
      errEl.style.display = "block";
      return;
    }
    try {
      const groups = await db.findGroupsByName(name);
      if (groups.length === 0) throw new Error("해당 이름의 약속을 찾을 수 없어요.");
      const pwHash = await sha256(pw);
      const match = groups.find((g) => g.passwordHash === pwHash);
      if (!match) throw new Error("비밀번호가 일치하지 않아요.");
      const user = getCurrentUser();
      await db.joinGroup(match.id, pwHash, user.userKey);
      navigate(`#/schedule/${match.id}`);
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = "block";
    }
  });
}

// ============================================================
// 화면 3. 약속 생성
// ============================================================
function viewCreateGroup() {
  let selectedType = "date";
  let selectedPeriod = 7;

  root.innerHTML = `
    <div class="card">
      <p class="eyebrow">Step 2-1</p>
      <h1 class="view-title">약속 만들기</h1>

      <div class="field">
        <label for="c-name">약속 이름</label>
        <input id="c-name" type="text" placeholder="예: 겨울 여행 날짜 정하기" />
      </div>
      <div class="field">
        <label for="c-pw">비밀번호</label>
        <input id="c-pw" type="password" placeholder="그룹원과 공유할 비밀번호" />
      </div>

      <div class="field">
        <label>약속 유형</label>
        <div class="radio-row">
          <div class="radio-card active" data-type="date">
            <strong>날짜 정하기</strong>
            <span>가능한 날짜만 조율해요</span>
          </div>
          <div class="radio-card" data-type="time">
            <strong>시간 정하기</strong>
            <span>날짜 + 30분 단위 시간</span>
          </div>
        </div>
      </div>

      <div class="field">
        <label>입력 가능 기간</label>
        <div class="chip-row" id="period-chips">
          ${[3, 7, 8, 14].map((d) => `<span class="chip ${d === 7 ? "active" : ""}" data-days="${d}">${d}일</span>`).join("")}
          <span class="chip" data-days="custom">직접 입력</span>
        </div>
        <input id="c-period-custom" type="text" inputmode="numeric" placeholder="일 수 입력 (예: 10)" style="display:none; margin-top:8px;" class="field-hint-input" />
      </div>

      <div id="create-error" class="field-error" style="display:none;"></div>
      <div class="actions-row">
        <button class="btn-secondary" id="c-cancel">취소</button>
        <button class="btn-primary" id="c-submit">약속 생성</button>
      </div>
    </div>`;

  document.querySelectorAll(".radio-card").forEach((el) => {
    el.addEventListener("click", () => {
      document.querySelectorAll(".radio-card").forEach((x) => x.classList.remove("active"));
      el.classList.add("active");
      selectedType = el.dataset.type;
    });
  });

  const customInput = document.getElementById("c-period-custom");
  document.querySelectorAll("#period-chips .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#period-chips .chip").forEach((x) => x.classList.remove("active"));
      chip.classList.add("active");
      if (chip.dataset.days === "custom") {
        customInput.style.display = "block";
        selectedPeriod = null;
      } else {
        customInput.style.display = "none";
        selectedPeriod = Number(chip.dataset.days);
      }
    });
  });
  customInput.addEventListener("input", () => {
    selectedPeriod = Number(customInput.value) || null;
  });

  document.getElementById("c-cancel").onclick = () => navigate("#/group");

  document.getElementById("c-submit").addEventListener("click", async () => {
    const name = document.getElementById("c-name").value.trim();
    const pw = document.getElementById("c-pw").value;
    const errEl = document.getElementById("create-error");
    errEl.style.display = "none";

    if (!name || !pw) return showErr("약속 이름과 비밀번호를 입력해주세요.");
    if (!selectedPeriod || selectedPeriod < 1) return showErr("올바른 입력 기간을 선택해주세요.");

    const btn = document.getElementById("c-submit");
    btn.disabled = true;
    btn.textContent = "생성 중...";
    try {
      const user = getCurrentUser();
      const passwordHash = await sha256(pw);
      const { groupId, inviteCode } = await db.createGroup({
        name,
        passwordHash,
        type: selectedType,
        periodDays: selectedPeriod,
        createdByKey: user.userKey,
      });
      navigate(`#/schedule/${groupId}?new=${inviteCode}`);
    } catch (e) {
      showErr("생성 중 오류: " + e.message);
      btn.disabled = false;
      btn.textContent = "약속 생성";
    }

    function showErr(msg) {
      errEl.textContent = msg;
      errEl.style.display = "block";
    }
  });
}

// ============================================================
// 화면 4. 초대 링크 진입
// ============================================================
async function viewInvite(codeWithQuery) {
  const code = codeWithQuery.split("?")[0];
  root.innerHTML = `<div class="card"><p class="view-sub">초대 정보를 확인하는 중...</p></div>`;
  const groupId = await db.resolveInviteCode(code);
  if (!groupId) return renderError("유효하지 않은 초대 링크예요.");

  if (!getCurrentUser()) {
    sessionStorage.setItem("meetup_redirect", `#/invite/${code}`);
    return navigate("#/register");
  }

  const group = await db.getGroup(groupId);
  if (!group) return renderError("약속을 찾을 수 없어요.");
  const user = getCurrentUser();

  if (group.members.includes(user.userKey)) {
    return navigate(`#/schedule/${groupId}`);
  }

  root.innerHTML = `
    <div class="card">
      <p class="eyebrow">초대받았어요</p>
      <h1 class="view-title">"${escapeHtml(group.name)}" 약속에 입장</h1>
      <p class="view-sub">비밀번호를 입력하면 바로 입장할 수 있어요.</p>
      <div class="field">
        <label for="inv-pw">비밀번호</label>
        <input id="inv-pw" type="password" />
      </div>
      <div id="inv-error" class="field-error" style="display:none;"></div>
      <div class="actions-row">
        <button class="btn-primary" id="inv-submit">입장하기</button>
      </div>
    </div>`;

  document.getElementById("inv-submit").addEventListener("click", async () => {
    const pw = document.getElementById("inv-pw").value;
    const errEl = document.getElementById("inv-error");
    try {
      const pwHash = await sha256(pw);
      await db.joinGroup(groupId, pwHash, user.userKey);
      navigate(`#/schedule/${groupId}`);
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = "block";
    }
  });
}

// ============================================================
// 화면 5. 일정 입력 / 결과 (자동 분기)
// ============================================================
async function viewSchedule(groupIdWithQuery) {
  const [groupId, queryStr] = groupIdWithQuery.split("?");
  const isNew = queryStr && queryStr.startsWith("new=");
  const inviteCode = isNew ? queryStr.split("=")[1] : null;

  const group = await db.getGroup(groupId);
  if (!group) return renderError("존재하지 않는 약속이에요.");
  const user = getCurrentUser();
  if (!group.members.includes(user.userKey)) {
    return renderError("이 약속에 참여할 권한이 없어요. 초대 링크나 비밀번호로 먼저 참여해주세요.");
  }

  const deadlineMs = group.deadlineAt?.toMillis ? group.deadlineAt.toMillis() : group.deadlineAt.seconds * 1000;
  const isClosed = Date.now() >= deadlineMs;

  const inviteBanner = isNew
    ? `<div class="card" style="margin-bottom:18px;">
         <p class="eyebrow">약속이 생성됐어요</p>
         <h1 class="view-title" style="font-size:19px;">초대 링크를 공유하세요</h1>
         <div class="invite-box">
           <span id="invite-url">${location.origin}${location.pathname}#/invite/${inviteCode}</span>
           <button class="btn-ghost" id="copy-invite" style="padding:6px 10px;">복사</button>
         </div>
       </div>`
    : "";

  if (isClosed) {
    root.innerHTML = inviteBanner;
    return renderResult(group, groupId);
  }

  root.innerHTML = `
    ${inviteBanner}
    <div class="card">
      <div class="deadline-banner">
        <span>⏳ ${escapeHtml(group.name)}</span>
        <span>${formatRemaining(deadlineMs - Date.now())}</span>
      </div>
      <p class="view-sub">칸을 <strong>클릭</strong>하면 X → ○ → △ 순서로 바뀌고, <strong>드래그</strong>하면 여러 칸을 한 번에 같은 상태로 칠할 수 있어요.</p>
      <div class="legend-row">
        <span><span class="dot" style="background:#c8ccc4"></span>X 불가능</span>
        <span><span class="dot" style="background:#4f8f63"></span>○ 가능</span>
        <span><span class="dot" style="background:#d8a233"></span>△ 가능하지만 비선호</span>
      </div>
      <div id="picker-root"></div>
      <div class="actions-row">
        <button class="btn-secondary" id="show-result">현재까지 결과 보기</button>
        <button class="btn-primary" id="save-answers">저장하기</button>
      </div>
    </div>`;

  if (inviteCode) {
    document.getElementById("copy-invite")?.addEventListener("click", () => {
      navigator.clipboard.writeText(document.getElementById("invite-url").textContent);
    });
  }

  const existing = await db.getMyResponse(groupId, user.userKey);
  const answers = existing?.answers ? { ...existing.answers } : {};

  const pickerRoot = document.getElementById("picker-root");
  if (group.type === "date") {
    mountDatePicker(pickerRoot, answers);
  } else {
    mountTimePicker(pickerRoot, answers);
  }

  document.getElementById("save-answers").addEventListener("click", async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = "저장 중...";
    try {
      await db.saveResponse(groupId, user.userKey, user.name, answers);
      btn.textContent = "저장 완료 ✓";
      setTimeout(() => {
        btn.textContent = "저장하기";
        btn.disabled = false;
      }, 1200);
    } catch (err) {
      alert("저장 실패: " + err.message);
      btn.disabled = false;
      btn.textContent = "저장하기";
    }
  });

  document.getElementById("show-result").addEventListener("click", async () => {
    root.innerHTML = "";
    await renderResult(group, groupId, true);
  });
}

// ---------------- 날짜 선택기 ----------------
function mountDatePicker(container, answers) {
  let viewMonth = new Date();
  viewMonth.setDate(1);

  function render() {
    const y = viewMonth.getFullYear();
    const m = viewMonth.getMonth();
    const first = new Date(y, m, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let cells = "";
    for (let i = 0; i < startOffset; i++) cells += `<div class="day-cell empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(y, m, d);
      const key = toDateKey(dateObj);
      const status = answers[key] || null;
      const isPast = dateObj < today;
      cells += `<div class="day-cell ${status ? "status-" + status : ""} ${isPast ? "past" : ""}"
                      data-key="${key}" data-status="${status || ""}">
                  <span>${d}</span>
                  <span class="mark">${status || ""}</span>
                </div>`;
    }

    container.innerHTML = `
      <div class="calendar-head">
        <button class="btn-ghost" id="prev-month" type="button">←</button>
        <span class="month-label">${y}년 ${m + 1}월</span>
        <button class="btn-ghost" id="next-month" type="button">→</button>
      </div>
      <div class="calendar-grid">
        ${["일", "월", "화", "수", "목", "금", "토"].map((d) => `<div class="dow">${d}</div>`).join("")}
        ${cells}
      </div>`;

    document.getElementById("prev-month").onclick = () => {
      viewMonth.setMonth(viewMonth.getMonth() - 1);
      render();
    };
    document.getElementById("next-month").onclick = () => {
      viewMonth.setMonth(viewMonth.getMonth() + 1);
      render();
    };

    attachDragPaint(container.querySelector(".calendar-grid"), (cell, status) => {
      const key = cell.dataset.key;
      if (!key) return;
      answers[key] = status;
    });
  }
  render();
}

// ---------------- 날짜+시간 선택기 ----------------
function mountTimePicker(container, answers) {
  const slots = buildTimeSlots(9, 23);
  let pickedDates = new Set(Object.keys(answers).map((k) => k.split("_")[0]));
  let viewMonth = new Date();
  viewMonth.setDate(1);

  function renderCalendarPart() {
    const y = viewMonth.getFullYear();
    const m = viewMonth.getMonth();
    const first = new Date(y, m, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let cells = "";
    for (let i = 0; i < startOffset; i++) cells += `<div class="day-cell empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(y, m, d);
      const key = toDateKey(dateObj);
      const isPast = dateObj < today;
      const picked = pickedDates.has(key);
      cells += `<div class="day-cell ${picked ? "status-O" : ""} ${isPast ? "past" : ""}" data-datekey="${key}">
                  <span>${d}</span>
                  <span class="mark">${picked ? "✓" : ""}</span>
                </div>`;
    }

    return `
      <p class="field-hint" style="margin-bottom:8px;">먼저 시간을 정할 날짜를 선택하세요 (여러 날짜 선택 가능).</p>
      <div class="calendar-head">
        <button class="btn-ghost" id="prev-month" type="button">←</button>
        <span class="month-label">${y}년 ${m + 1}월</span>
        <button class="btn-ghost" id="next-month" type="button">→</button>
      </div>
      <div class="calendar-grid" id="date-select-grid">
        ${["일", "월", "화", "수", "목", "금", "토"].map((d) => `<div class="dow">${d}</div>`).join("")}
        ${cells}
      </div>`;
  }

  function renderSlotsPart() {
    const sortedDates = [...pickedDates].sort();
    if (sortedDates.length === 0) {
      return `<p class="empty-state">선택된 날짜가 없어요. 위 달력에서 날짜를 먼저 선택해주세요.</p>`;
    }
    return sortedDates
      .map((dateKey) => {
        const slotCells = slots
          .map((t) => {
            const key = `${dateKey}_${t}`;
            const status = answers[key] || null;
            return `<div class="slot-cell ${status ? "status-" + status : ""}" data-key="${key}" data-status="${status || ""}">${t}</div>`;
          })
          .join("");
        return `<div class="time-day-block" data-date="${dateKey}">
                  <div class="day-title">${dateKey}</div>
                  <div class="slot-grid">${slotCells}</div>
                </div>`;
      })
      .join("");
  }

  function fullRender() {
    container.innerHTML = `
      <div>${renderCalendarPart()}</div>
      <div id="slots-container" style="margin-top:18px;">${renderSlotsPart()}</div>`;

    document.getElementById("prev-month").onclick = () => {
      viewMonth.setMonth(viewMonth.getMonth() - 1);
      fullRender();
    };
    document.getElementById("next-month").onclick = () => {
      viewMonth.setMonth(viewMonth.getMonth() + 1);
      fullRender();
    };

    document.getElementById("date-select-grid").addEventListener("click", (e) => {
      const cell = e.target.closest(".day-cell");
      if (!cell || cell.classList.contains("empty") || cell.classList.contains("past")) return;
      const key = cell.dataset.datekey;
      if (pickedDates.has(key)) {
        pickedDates.delete(key);
        // 선택 해제 시 해당 날짜의 답변도 정리
        Object.keys(answers).forEach((k) => {
          if (k.startsWith(key + "_")) delete answers[k];
        });
      } else {
        pickedDates.add(key);
      }
      fullRender();
    });

    const slotsContainer = document.getElementById("slots-container");
    attachDragPaint(slotsContainer, (cell, status) => {
      const key = cell.dataset.key;
      if (!key) return;
      answers[key] = status;
    }, ".slot-cell");
  }

  fullRender();
}

// ---------------- 클릭/드래그 공통 페인트 유틸 ----------------
function attachDragPaint(container, onApply, cellSelector = ".day-cell:not(.empty):not(.past)") {
  let dragging = false;
  let paintStatus = null;
  let touched = new Set();

  function cellFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest(cellSelector) : null;
  }

  function applyCell(cell, status) {
    cell.dataset.status = status;
    cell.classList.remove("status-X", "status-O", "status-△");
    cell.classList.add("status-" + status);
    // 날짜 셀은 안의 .mark 스팬에 기호를 표시하고,
    // 시간 슬롯 셀은 시간 텍스트 자체는 유지한 채 배경/테두리 색으로만 상태를 표현한다.
    const markEl = cell.querySelector(".mark");
    if (markEl) markEl.textContent = status;
    onApply(cell, status);
  }

  function start(e) {
    const point = e.touches ? e.touches[0] : e;
    const cell = cellFromPoint(point.clientX, point.clientY);
    if (!cell) return;
    dragging = true;
    touched.clear();
    const current = cell.dataset.status || "X";
    paintStatus = nextStatus(current);
    applyCell(cell, paintStatus);
    touched.add(cell.dataset.key);
    e.preventDefault();
  }
  function move(e) {
    if (!dragging) return;
    const point = e.touches ? e.touches[0] : e;
    const cell = cellFromPoint(point.clientX, point.clientY);
    if (!cell || touched.has(cell.dataset.key)) return;
    applyCell(cell, paintStatus);
    touched.add(cell.dataset.key);
    e.preventDefault();
  }
  function end() {
    dragging = false;
  }

  container.addEventListener("mousedown", start);
  container.addEventListener("mousemove", move);
  window.addEventListener("mouseup", end);
  container.addEventListener(
    "touchstart",
    start,
    { passive: false }
  );
  container.addEventListener("touchmove", move, { passive: false });
  window.addEventListener("touchend", end);
}

// ---------------- 슬롯 셀 텍스트 보정 (mark 스팬이 없으므로 별도 처리) ----------------
// slot-cell 은 텍스트 자체가 시간이므로 상태는 배경색/테두리로만 표현합니다.
// 위 attachDragPaint 의 fallback 분기가 이를 처리합니다.

// ============================================================
// 화면 6. 결과 보기
// ============================================================
async function renderResult(group, groupId, preview = false) {
  const responses = await db.getAllResponses(groupId);
  const totalMembers = responses.length;

  // 집계: key -> { O: n, △: n, names: [] }
  const tally = {};
  responses.forEach((r) => {
    Object.entries(r.answers || {}).forEach(([key, status]) => {
      if (status === "X") return;
      if (!tally[key]) tally[key] = { count: 0, names: [] };
      tally[key].count += 1;
      tally[key].names.push(r.userName + (status === "△" ? "(비선호)" : ""));
    });
  });

  const rows = Object.entries(tally)
    .map(([key, v]) => ({
      key,
      pct: totalMembers === 0 ? 0 : Math.round((v.count / totalMembers) * 100),
      names: v.names,
    }))
    .filter((r) => r.pct > 0)
    .sort((a, b) => b.pct - a.pct);

  const rowsHtml = rows.length
    ? rows
        .map((r) => {
          const color = percentToColor(r.pct);
          const label = group.type === "date" ? r.key : r.key.replace("_", " ");
          return `<div class="result-row" style="background:${color}">
                    <span class="r-label">${escapeHtml(label)}</span>
                    <span class="r-names">${escapeHtml(r.names.join(", "))}</span>
                    <span class="r-pct">${r.pct}%</span>
                  </div>`;
        })
        .join("")
    : `<div class="empty-state">아직 표시할 만큼 가능하다고 응답한 일정이 없어요.</div>`;

  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <p class="eyebrow">${preview ? "중간 결과" : "최종 결과"}</p>
    <h1 class="view-title">${escapeHtml(group.name)}</h1>
    <p class="view-sub">${preview ? "아직 입력 기간이 남아있어요. 지금까지의 응답을 기준으로 보여줘요." : "입력 기간이 마감되어 결과만 볼 수 있어요."} 총 ${totalMembers}명 참여</p>
    ${rowsHtml}
    <div class="actions-row">
      ${preview ? `<button class="btn-secondary" id="back-to-input">입력으로 돌아가기</button>` : `<button class="btn-secondary" id="back-home">그룹 홈으로</button>`}
    </div>
  `;
  root.appendChild(card);

  if (preview) {
    document.getElementById("back-to-input").onclick = () => viewSchedule(groupId);
  } else {
    document.getElementById("back-home").onclick = () => navigate("#/group");
  }
}

// ---------------- 시작 ----------------
route();
