// ============================================================
// firebase-config.js
// Firebase 프로젝트 설정 및 초기화
// ------------------------------------------------------------
// 1) https://console.firebase.google.com 에서 새 프로젝트 생성 (무료 Spark 요금제)
// 2) 프로젝트 설정 > 일반 > "웹 앱 추가" 로 아래 값을 발급받아 교체
// 3) Authentication > Sign-in method > "익명" 로그인 활성화
// 4) Firestore Database 생성 (프로덕션 모드로 시작 후 firestore.rules 배포)
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// TODO: 아래 값을 본인의 Firebase 프로젝트 설정으로 교체하세요.
const firebaseConfig = {
  apiKey: "AIzaSyDc1cdX9I3WDySOWXMivL-sMR9aOXqFing",
  authDomain: "meetup-app-8703e.firebaseapp.com",
  projectId: "meetup-app-8703e",
  storageBucket: "meetup-app-8703e.firebasestorage.app",
  messagingSenderId: "647386609005",
  appId: "1:647386609005:web:7ea6f11e962b71f8e19664",
  measurementId: "G-YRLWYKCH8S"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// 앱 전체에서 재사용할, "익명 로그인이 끝났음"을 알려주는 Promise.
// Firestore 보안 규칙이 request.auth != null 을 요구하므로
// 모든 화면 진입 전에 반드시 이 로그인이 완료되어야 합니다.
export const authReady = new Promise((resolve) => {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      resolve(user);
    } else {
      signInAnonymously(auth).catch((err) => {
        console.error("익명 로그인 실패:", err);
      });
    }
  });
});
