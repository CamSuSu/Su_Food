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

    // 💡 確保相容性：不管是舊版存的 token 欄位，還是新版存的 document ID，通通抓出來，一台都不漏！
    tokensSnapshot.forEach(doc => {
      const t = doc.data().token || doc.id;
      if (t && !tokens.includes(t)) {
        tokens.push(t);
      }
    });

    if (tokens.length === 0) {
      console.log('ℹ️ 資料庫中目前沒有任何裝置 Token，跳過發送。');
      return;
    }

    console.log(`📡 準備對 ${tokens.length} 個裝置發送通知...`);

    // 2. 準備推播訊息內容 (🚀 改為 Data-Only 純資料推播，徹底解決重複通知)
    const baseMessage = {
      data: {
        title: '🍔 Su.線上點餐活動開始囉！',
        body: '有人發起了點餐活動，趕快打開系統點餐吧！！',
        url: '/'
      },

      // [Android 原生] 宣告高優先級
      android: {
        priority: 'high'
      },

      // [iOS / APNs] 強制背景喚醒 (確保 iOS 接收純資料推播)
      apns: {
        headers: {
          'apns-priority': '10',
        },
        payload: {
          aps: {
            'content-available': 1, 
            sound: 'default'
          }
        }
      },

      // [Web Push / PWA] 給瀏覽器的設定 (精簡版，UI 繪製全交給 SW 負責)
      webpush: {
        headers: { 
          Urgency: 'high', 
          TTL: '86400'
        }
      }
    };

    // 3. 執行批次發送 (加入 500 人分批保護機制，避免未來人數增加時直接當機)
    const chunkSize = 500;
    let successCount = 0;
    let failureCount = 0;
    const failedTokens = [];

    for (let i = 0; i < tokens.length; i += chunkSize) {
      const chunkTokens = tokens.slice(i, i + chunkSize);
      const message = {
        ...baseMessage,
        tokens: chunkTokens
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      successCount += response.successCount;
      failureCount += response.failureCount;

      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errCode = resp.error?.code;
            if (errCode === 'messaging/invalid-registration-token' ||
                errCode === 'messaging/registration-token-not-registered') {
              failedTokens.push(chunkTokens[idx]);
            }
          }
        });
      }
    }

    console.log(`✅ 成功發送 ${successCount} 則通知，失敗 ${failureCount} 則。`);

    // 4. 自動維護：清理失效的 Token
    if (failedTokens.length > 0) {
      console.log(`🧹 偵測到 ${failedTokens.length} 個失效 Token，正在從 Firestore 清除...`);
      const batch = db.batch();
      
      for (const t of failedTokens) {
        const querySnapshot = await db.collection('su_system_tokens').where('token', '==', t).get();
        if (!querySnapshot.empty) {
          querySnapshot.forEach(doc => batch.delete(doc.ref));
        } else {
          batch.delete(db.collection('su_system_tokens').doc(t));
        }
      }
      
      await batch.commit();
      console.log(`✅ 已自動完成失效 Token 清理。`);
    }

  } catch (error) {
    console.error('❌ 發送通知發生嚴重錯誤:', error);
  }
}

// 開始執行
sendNotification();
