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
        body: '家禾發起了團體點餐，趕快打開系統選擇想吃的餐點吧！',
      },
      // 確保 Android 與 iOS 在背景時能發出聲音
      android: { notification: { sound: 'default' } },
      apns: { payload: { aps: { sound: 'default' } } },
      tokens: tokens, // 傳送給所有收集到的裝置
    };

    // 3. 執行批次發送
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`成功發送 ${response.successCount} 則通知，失敗 ${response.failureCount} 則。`);
  } catch (error) {
    console.error('發送通知發生嚴重錯誤:', error);
  }
}

sendNotification();
