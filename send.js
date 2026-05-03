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
    // 🚀 核心修正：強制 Android 突破休眠模式，在鎖定畫面立即喚醒顯示
    android: {
      priority: 'high', // 突破休眠的關鍵設定
      notification: {
        visibility: 'public', // 允許在螢幕鎖定時顯示
        sound: 'default',
        defaultVibrateTimings: true // 開啟原生震動喚醒
      }
    },
    webpush: {
      headers: { Urgency: 'high' },
      fcmOptions: { link: '/' }
    },
    apns: {
      payload: { aps: { sound: 'default', badge: 1 } }
    },
    tokens: tokens, 
  };
    
    // 3. 執行批次發送
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`成功發送 ${response.successCount} 則通知，失敗 ${response.failureCount} 則。`);
  } catch (error) {
    console.error('發送通知發生嚴重錯誤:', error);
  }
}

sendNotification();
