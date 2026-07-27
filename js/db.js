// ============================================================
// db.js  —  Firestore 데이터 접근 레이어
// 컬렉션 구조:
//   users/{autoId}                — { name, birth, userKey, createdAt }
//   groups/{groupId}              — { name, type, passwordHash, deadlineAt,
//                                      periodDays, createdBy, createdAt, members[] }
//   groups/{groupId}/responses/{userKey}
//                                  — { userName, answers: {...}, updatedAt }
//   groups/{groupId}/results/summary
//                                  — { computedAt, totals: {...} } (캐시, 클라이언트가 재계산)
//   invitations/{code}            — { groupId, createdAt }
// ============================================================

import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  query,
  where,
  arrayUnion,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { makeUserKey, makeInviteCode } from "./utils.js";

// ---------------- Users ----------------

/** 이름+생년월일로 기존 사용자를 찾는다. 없으면 null. */
export async function findUser(name, birth) {
  const userKey = makeUserKey(name, birth);
  const q = query(collection(db, "users"), where("userKey", "==", userKey));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

/** 신규 사용자 등록 (이미 있으면 만들지 않고 그대로 반환) */
export async function findOrCreateUser(name, birth) {
  const existing = await findUser(name, birth);
  if (existing) return existing;
  const userKey = makeUserKey(name, birth);
  const ref = await addDoc(collection(db, "users"), {
    name: name.trim(),
    birth: birth.trim(),
    userKey,
    createdAt: serverTimestamp(),
  });
  return { id: ref.id, name: name.trim(), birth: birth.trim(), userKey };
}

// ---------------- Groups ----------------

/** 이름으로 그룹 검색 (동명 그룹이 여러 개일 수 있어 배열 반환) */
export async function findGroupsByName(name) {
  const q = query(collection(db, "groups"), where("name", "==", name.trim()));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getGroup(groupId) {
  const ref = doc(db, "groups", groupId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/** 새 약속(그룹) 생성 + 초대코드 발급 */
export async function createGroup({
  name,
  passwordHash,
  type,
  periodDays,
  createdByKey,
}) {
  const deadlineAt = Timestamp.fromMillis(
    Date.now() + periodDays * 24 * 60 * 60 * 1000
  );
  const groupRef = await addDoc(collection(db, "groups"), {
    name: name.trim(),
    type, // 'date' | 'time'
    passwordHash,
    periodDays,
    deadlineAt,
    createdBy: createdByKey,
    createdAt: serverTimestamp(),
    members: [createdByKey],
  });

  const inviteCode = makeInviteCode();
  await setDoc(doc(db, "invitations", inviteCode), {
    groupId: groupRef.id,
    createdAt: serverTimestamp(),
  });

  return { groupId: groupRef.id, inviteCode };
}

/** 비밀번호 확인 후 그룹 멤버로 등록 (해시 일치 시에만 규칙상 쓰기 허용) */
export async function joinGroup(groupId, passwordHash, userKey) {
  const group = await getGroup(groupId);
  if (!group) throw new Error("존재하지 않는 약속입니다.");
  if (group.passwordHash !== passwordHash) {
    throw new Error("비밀번호가 일치하지 않습니다.");
  }
  if (!group.members.includes(userKey)) {
    await updateDoc(doc(db, "groups", groupId), {
      members: arrayUnion(userKey),
    });
  }
  return group;
}

export async function resolveInviteCode(code) {
  const ref = doc(db, "invitations", code);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data().groupId;
}

// ---------------- Responses ----------------

/** 참여자 한 명의 응답을 덮어쓴다 (upsert) */
export async function saveResponse(groupId, userKey, userName, answers) {
  const ref = doc(db, "groups", groupId, "responses", userKey);
  await setDoc(
    ref,
    { userName, answers, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function getMyResponse(groupId, userKey) {
  const ref = doc(db, "groups", groupId, "responses", userKey);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

/** 그룹의 전체 응답 목록 (결과 집계용) */
export async function getAllResponses(groupId) {
  const snap = await getDocs(collection(db, "groups", groupId, "responses"));
  return snap.docs.map((d) => ({ userKey: d.id, ...d.data() }));
}

// ---------------- Results (캐시) ----------------

/** 집계 결과를 캐시 문서에 저장 (선택적, 다음 방문 시 재계산 비용 절감용) */
export async function cacheResults(groupId, totals) {
  const ref = doc(db, "groups", groupId, "results", "summary");
  await setDoc(ref, { totals, computedAt: serverTimestamp() });
}
