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
      webpush: {
        headers: {
          urgency: 'high' // 【關鍵】必須是小寫，強制安卓提高優先級
        },
        notification: {
          vibrate: [500, 200, 500, 200, 500], // 【關鍵】安卓專屬的強烈震動模式
          requireInteraction: true, // 讓通知停在畫面上不消失
          icon: '/images/sufood.png'
        },
        fcmOptions: {
          link: 'https://您的網域.com' // 【關鍵】請務必填寫您的網址，點擊通知才會自動開啟系統
        }
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default', contentAvailable: true } }
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
