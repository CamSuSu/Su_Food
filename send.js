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
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function sendNotification() {
  try {
    // 1. 從 Firestore 讀取所有使用者的裝置 Token
    const tokensSnapshot = await db.collection('su_system_tokens').get();
    const tokens = [];
    tokensSnapshot.forEach(doc => tokens.push(doc.id)); // 💡 修正：因為 Document ID 就是 Token，直接取 id 更快

    if (tokens.length === 0) {
      console.log('ℹ️ 資料庫中目前沒有任何裝置 Token，跳過發送。');
      return;
    }

    console.log(`📡 準備對 ${tokens.length} 個裝置發送通知...`);

    // 2. 準備推播訊息內容 (完美兼容 Android 鎖定喚醒 與 PWA 點擊)
    const message = {
      notification: {
        title: '🍔 Su.線上點餐活動開始囉！',
        body: '有人發起了點餐活動，趕快打開系統點餐吧！！',
      },

      data: {
        click_action: '/', // 保留給某些舊版瀏覽器識別
        url: '/'
      },

      // [Android 原生] 最高權限宣告，穿透休眠模式
      android: {
        priority: 'high', 
        notification: {
          visibility: 'PUBLIC', 
          channelId: 'default',
          defaultSound: true,
          defaultVibrateTimings: true
          // 💡 已移除會導致誤判的 Flutter clickAction
        }
      },

      // [iOS / APNs] 強制喚醒
      apns: {
        headers: {
          'apns-priority': '10',
        },
        payload: {
          aps: {
            alert: {
              title: '🍔 Su.線上點餐活動開始囉！',
              body: '有人發起了點餐活動，趕快打開系統點餐吧！！',
            },
            sound: 'default',
            badge: 1
          }
        }
      },

      // [Web Push / PWA] 給瀏覽器的設定
      webpush: {
        headers: { 
          Urgency: 'high', 
          TTL: '86400'
        },
        notification: {
          // ⚠️ 記得把下方網址換成你的真實網域 (例如: https://su-food.com/images/sufood.png)
          icon: 'https://github.com/CamSuSu/Su_Food/blob/8e7bfce703902a7bc05290c4f378b08cbe21f44d/images/sufood.png', 
          badge: 'https://github.com/CamSuSu/Su_Food/blob/8e7bfce703902a7bc05290c4f378b08cbe21f44d/images/sufood.png',
          vibrate: [500, 250, 500, 250, 500],
          requireInteraction: true 
        },
        fcm_options: {
          link: '/' // 💡 確保 PWA 點擊通知時會正確開啟網頁或跳轉回首頁
        }
      },
      
      tokens: tokens, 
    };

    // 3. 執行批次發送 (使用 Firebase Admin SDK V11+ 建議的發送方式)
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`✅ 成功發送 ${response.successCount} 則通知，失敗 ${response.failureCount} 則。`);

    // 4. 自動維護：清理失效的 Token (大幅優化效能版)
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errCode = resp.error?.code;
          if (errCode === 'messaging/invalid-registration-token' ||
              errCode === 'messaging/registration-token-not-registered') {
            failedTokens.push(tokens[idx]);
          }
        }
      });

      if (failedTokens.length > 0) {
        console.log(`🧹 偵測到 ${failedTokens.length} 個失效 Token，正在從 Firestore 清除...`);
        const batch = db.batch();
        
        // 💡 修正：直接用 Document ID 刪除，不需浪費效能做 query 搜尋
        failedTokens.forEach(t => {
          const docRef = db.collection('su_system_tokens').doc(t);
          batch.delete(docRef);
        });

        await batch.commit();
        console.log(`✅ 已自動完成失效 Token 清理。`);
      }
    }

  } catch (error) {
    console.error('❌ 發送通知發生嚴重錯誤:', error);
  }
}

// 開始執行
sendNotification();
