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

    // 2. 準備推播訊息內容 (🚀 整合了 iOS/Android/Web 終極高優先級配置)
    const message = {
      notification: {
        title: '🍔 Su.線上點餐活動開始囉！',
        body: '有人發起了點餐活動，趕快打開系統點餐吧！！',
      },
      data: {
        click_action: '/index.html'
      },
      
      // 🚀 Android 配置：強制突破休眠 (Doze) 與鎖定畫面
      android: {
        priority: 'high', // <-- 最高優先級，要求立即發送
        notification: {
          visibility: 'public',
          sound: 'default',
          defaultVibrateTimings: true,
          color: '#f97316',
          channelId: 'high_importance_channel' // 建議加上，確保 Android 8.0 以上的通道優先級
        }
      },
      
      // 🚀 Web 端 (包含 iOS/Android PWA) 配置
      webpush: {
        headers: { 
          Urgency: 'high', // <-- 要求瀏覽器/系統立即處理
          TTL: '86400'     // 設定存活時間(秒)，避免過期通知狂跳
        },
        notification: {
          icon: 'images/sufood.png',
          badge: 'images/sufood.png',
          requireInteraction: true // 強制通知持續顯示直到使用者點擊
        },
        fcmOptions: { 
          link: '/index.html' 
        }
      },
      
      // 🚀 APNS (iOS 原生與 PWA) 配置：拯救 iOS 漏通知的關鍵
      apns: {
        headers: {
          'apns-priority': '10',      // <-- 🚀 關鍵：10 代表立即發送，不可延遲！(5是背景發送)
          'apns-push-type': 'alert'   // <-- 🚀 關鍵：明確告訴蘋果這是一則需要彈出的警告通知
        },
        payload: { 
          aps: { 
            sound: 'default', 
            badge: 1,
            'content-available': 1,   // 允許背景喚醒
            'mutable-content': 1      // 允許 iOS 在顯示前處理通知內容
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
