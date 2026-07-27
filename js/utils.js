// ============================================================
// utils.js  —  공통 유틸리티 함수 모음
// ============================================================

/** 문자열을 SHA-256 해시(hex)로 변환. 비밀번호를 평문으로 저장하지 않기 위해 사용. */
export async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 이름+생년월일로부터 사용자 고유 키를 만든다. (동명이인은 생년월일로 구분) */
export function makeUserKey(name, birth) {
  return `${name.trim()}_${birth.trim()}`;
}

/** 짧은 무작위 초대 코드 생성 (초대 링크용) */
export function makeInviteCode(len = 8) {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789"; // 혼동되는 문자 제외
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/** YYYY-MM-DD 형식 문자열로 변환 */
export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 6자리 생년월일(YYMMDD) 형식 검증 */
export function isValidBirth6(str) {
  return /^\d{6}$/.test(str);
}

/** 30분 단위 시간 슬롯 배열 생성. 기본 09:00 ~ 23:30 */
export function buildTimeSlots(startHour = 9, endHour = 23) {
  const slots = [];
  for (let h = startHour; h <= endHour; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
}

/** 상태값 순환: X -> O -> △ -> X */
export const STATUS_CYCLE = ["X", "O", "△"];
export function nextStatus(current) {
  const idx = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

/** 참여율(%) -> 결과 화면 그라데이션 색상 매핑 (요구사항 고정 스펙) */
export function percentToColor(pct) {
  if (pct >= 100) return "#1B7A3D"; // 진한 녹색
  if (pct >= 75) return "#7FC97F"; // 연한 녹색
  if (pct >= 50) return "#F4C430"; // 노란색
  if (pct >= 25) return "#F2994A"; // 주황색
  return null; // 0% 는 표시하지 않음
}

/** 밀리초 -> "n일 m시간" 형태 남은 기간 텍스트 */
export function formatRemaining(ms) {
  if (ms <= 0) return "마감됨";
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  if (days > 0) return `${days}일 ${hours}시간 남음`;
  const min = totalMin % 60;
  return `${hours}시간 ${min}분 남음`;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
