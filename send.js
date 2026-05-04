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

    // 2. 準備推播訊息內容 (🚀 PWA 專用終極喚醒配置)
    const message = {
      // 這是基本資訊，給系統備用
      notification: {
        title: '🍔 Su.線上點餐活動開始囉！',
        body: '有人發起了點餐活動，趕快打開系統點餐吧！！',
      },
      
      // 🚀 因為您是 PWA，瀏覽器「只會解析」 webpush 這一塊！
      webpush: {
        headers: { 
          Urgency: 'high', // <-- 突破 Android 休眠與 iOS 背景限制的最關鍵參數
          TTL: '86400'
        },
        notification: {
          // 在 webpush 裡再宣告一次，確保瀏覽器優先套用這裡的設定
          title: '🍔 Su.線上點餐活動開始囉！', 
          body: '有人發起了點餐活動，趕快打開系統點餐吧！！',
          icon: '/images/sufood.png', // 建議加上斜線，確保路徑正確
          badge: '/images/sufood.png',
          requireInteraction: true, // 強制通知停留在畫面上不自動消失
          vibrate: [500, 250, 500, 250, 500], // 強制觸發震動引擎
          renotify: true, // 🚀 關鍵：即使畫面上已經有舊通知，也要強制發出聲音/震動喚醒
          tag: 'su-food-order', // renotify 必須搭配 tag 使用才能生效
          silent: false // 強制不靜音
        },
        fcmOptions: { 
          link: '/index.html' // 點擊後喚醒 PWA 回到主頁
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
