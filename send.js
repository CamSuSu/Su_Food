const admin = require('firebase-admin');

/**
 * ==========================================
 * 1. 安全檢查與環境驗證
 * ==========================================
 */
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ 錯誤：找不到環境變數 FIREBASE_SERVICE_ACCOUNT。");
  console.error("請確認您的 GitHub Repo > Settings > Secrets > Actions 中已正確設定金鑰。");
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  console.log("✅ 環境變數讀取成功，JSON 格式正確。");
} catch (e) {
  console.error("❌ 錯誤：FIREBASE_SERVICE_ACCOUNT 的內容不是有效的 JSON 格式。");
  process.exit(1);
}

// 使用萬能鑰匙登入 Firebase 系統
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function sendNotification() {
  try {
    // 1. 從 Firestore 讀取所有使用者的裝置 Token
    const tokensSnapshot = await db.collection('su_system_tokens').get();
    const tokens = [];
    tokensSnapshot.forEach(doc => tokens.push(doc.data().token));

    if (tokens.length === 0) {
      console.log('ℹ️ 資料庫中目前沒有任何裝置 Token，跳過發送。');
      return;
    }

    console.log(`📡 準備對 ${tokens.length} 個裝置發送通知...`);

    // 2. 準備推播訊息內容 (🚀 最終解法：純資料訊息 Data-Only Message)
    const message = {
      // 🚨 絕對刪除這裡的 `notification: { ... }` 區塊 🚨
      
      // 將所有的標題與內容放進 data 裡
      data: {
        title: '🍔 Su.線上點餐活動開始囉！',
        body: '有人發起了點餐活動，趕快打開系統點餐吧！！',
        click_action: '/index.html' // 讓 Service Worker 知道點擊後要去哪
      },

      // [Android 原生] 強制喚醒
      android: {
        priority: 'high', 
        // 🚨 絕對刪除這裡的 `notification: { ... }` 區塊 🚨
      },

      // [iOS / APNs] 強制喚醒 (iOS PWA 同樣依賴 Data Message 喚醒)
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'background' // 改為 background 喚醒
        },
        payload: {
          aps: {
            'content-available': 1  // 這是純資料喚醒 iOS 的金鑰
          }
        }
      },

      // [Web Push / PWA] 給瀏覽器的最高優先級
      webpush: {
        headers: { 
          Urgency: 'high', 
          TTL: '86400'
        }
        // 🚨 絕對刪除這裡的 `notification: { ... }` 區塊 🚨
      },
      
      tokens: tokens, 
    };

    // 3. 執行批次發送
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`✅ 成功發送 ${response.successCount} 則通知，失敗 ${response.failureCount} 則。`);

    // 4. 自動維護：清理失效的 Token
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          if (resp.error.code === 'messaging/invalid-registration-token' ||
              resp.error.code === 'messaging/registration-token-not-registered') {
            failedTokens.push(tokens[idx]);
          }
        }
      });

      if (failedTokens.length > 0) {
        console.log(`🧹 偵測到 ${failedTokens.length} 個失效 Token，正在從 Firestore 清除...`);
        for (const t of failedTokens) {
          const query = await db.collection('su_system_tokens').where('token', '==', t).get();
          query.forEach(doc => doc.ref.delete());
        }
        console.log(`✅ 已自動完成失效 Token 清理。`);
      }
    }

  } catch (error) {
    console.error('❌ 發送通知發生嚴重錯誤:', error);
  }
}

// 開始執行
sendNotification();
