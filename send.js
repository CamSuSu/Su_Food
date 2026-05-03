const admin = require('firebase-admin');

/**
 * ==========================================
 * 1. 安全檢查與環境驗證
 * ==========================================
 * 在嘗試解析 JSON 之前，先確認 GitHub Secrets 的環境變數是否存在。
 * 這能避免腳本在變數未定義時噴出難以理解的 SyntaxError。
 */
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ 錯誤：找不到環境變數 FIREBASE_SERVICE_ACCOUNT。");
  console.error("請確認您的 GitHub Repo > Settings > Secrets > Actions 中已正確設定金鑰。");
  process.exit(1); // 強制停止執行並將 GitHub Action 標記為失敗
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

    // 2. 準備推播訊息內容
    const message = {
      notification: {
        title: '🍔 Su.線上點餐活動開始囉！',
        body: '家禾發起了團體點餐，趕快進入系統選擇想吃的餐點吧！！',
      },
      // 加入數據載荷，確保背景喚醒與點擊跳轉
      data: {
        click_action: '/index.html' // 明確指向 index.html[cite: 8]
      },
      // 🚀 Android 配置：確保突破休眠與鎖定畫面提醒
      android: {
        priority: 'high',
        notification: {
          visibility: 'public', // 允許在螢幕鎖定時顯示
          sound: 'default',
          defaultVibrateTimings: true,
          color: '#f97316' 
        }
      },
      // 🚀 Web 端 (包含 iOS/Android 瀏覽器 PWA)
      webpush: {
        headers: { 
          Urgency: 'high' 
        },
        notification: {
          icon: 'images/sufood.png',
          badge: 'images/sufood.png',
          requireInteraction: true // ✅ 強制通知持續顯示直到使用者點擊[cite: 6]
        },
        fcmOptions: { 
          link: '/index.html' // ✅ 點擊通知後開啟主網頁[cite: 8]
        }
      },
      // 🚀 APNS (iOS 原生) 配置
      apns: {
        payload: { 
          aps: { 
            sound: 'default', 
            badge: 1,
            'content-available': 1 // 允許背景喚醒執行震動提醒[cite: 7]
          } 
        }
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
          // 標記無效或已取消註冊的 Token[cite: 6]
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
