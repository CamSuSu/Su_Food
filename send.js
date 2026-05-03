const admin = require('firebase-admin');

// 讀取存在 GitHub Secrets 裡的金鑰
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

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
      console.log('資料庫中沒有找到任何裝置 Token。');
      return;
    }

   // 2. 準備推播訊息內容
    const message = {
      notification: {
        title: '🍔 Su.線上點餐活動開始囉！',
        body: '有人發起了點餐活動，趕快打開系統點餐吧！！',
      },
      // 加入自訂數據，確保各平台 Service Worker 都能讀取到跳轉連結
      data: {
        click_action: '/index.html' // ✅ 明確指向 index.html
      },
      // 🚀 Android 突破休眠配置
      android: {
        priority: 'high',
        notification: {
          visibility: 'public',
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
          requireInteraction: true // ✅ 強制通知在未解鎖或鎖定畫面停留在畫面上
        },
        fcmOptions: { 
          link: '/index.html' // ✅ 點擊通知直接開啟主網頁[cite: 8]
        }
      },
      // 🚀 iOS 原生通知等級配置
      apns: {
        payload: { 
          aps: { 
            sound: 'default', 
            badge: 1,
            'content-available': 1 // 允許背景喚醒震動
          } 
        }
      },
      tokens: tokens, 
    };
    
    // 3. 執行批次發送
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`成功發送 ${response.successCount} 則通知，失敗 ${response.failureCount} 則。`);

    // 4. (進階建議) 如果發送失敗，代表 Token 可能過期，建議在此清理資料庫中的無效 Token
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          // 如果錯誤原因是 Token 不合法，就標記起來準備刪除
          if (resp.error.code === 'messaging/invalid-registration-token' ||
              resp.error.code === 'messaging/registration-token-not-registered') {
            failedTokens.push(tokens[idx]);
          }
        }
      });
      
      // 這裡可以寫一小段迴圈從 Firestore 刪除 failedTokens
      for (const t of failedTokens) {
        const query = await db.collection('su_system_tokens').where('token', '==', t).get();
        query.forEach(doc => doc.ref.delete());
      }
      console.log(`已自動清理 ${failedTokens.length} 個失效裝置 Token。`);
    }

  } catch (error) {
    console.error('發送通知發生嚴重錯誤:', error);
  }
}

sendNotification();
