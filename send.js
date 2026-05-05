const admin = require('firebase-admin');

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ 錯誤：找不到環境變數 FIREBASE_SERVICE_ACCOUNT。");
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (e) {
  console.error("❌ 錯誤：FIREBASE_SERVICE_ACCOUNT 不是有效的 JSON 格式。");
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function sendNotification() {
  try {
    const tokensSnapshot = await db.collection('su_system_tokens').get();
    const tokens = [];

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

    // 【修正核心】修復 Firebase Admin SDK 嚴格的資料格式要求
    const baseMessage = {
        notification: {
            title: '🍔 Su.線上點餐活動開始囉！',
            body: '有人發起了點餐活動，趕快打開系統點餐吧！！'
        },
        data: {
            url: '/',
        },
        android: {
            priority: 'high',
            ttl: 300000, // 💡 修正 1：Admin SDK 的 ttl 必須是數字(毫秒)，不能用字串 '300s'
            notification: {
                channelId: 'su_food_urgent',
                defaultVibrateTimings: true,
                visibility: 'PUBLIC',
                notificationPriority: 'PRIORITY_MAX',
                sound: 'default',
                tag: 'su-food-order'
            } // 💡 修正 2：移除 Admin SDK 不支援的巢狀 priority 屬性
        },
        apns: {
            payload: {
                aps: {
                    alert: {
                        title: '🍔 Su.線上點餐活動開始囉！',
                        body: '有人發起了點餐活動，趕快打開系統點餐吧！！'
                    },
                    sound: 'default',
                    badge: 1,
                    'content-available': 1,
                    'interruption-level': 'time-sensitive'
                }
            } // 💡 修正 3：移除格式錯誤的 apns-expiration 標頭
        },
        webpush: {
            headers: {
                urgency: 'high', // 🚨 關鍵修正：必須為全小寫，強制突破 Android 網路休眠
                ttl: '86400'
            },
            notification: {
                title: '🍔 Su.線上點餐活動開始囉！',
                body: '有人發起了點餐活動，趕快打開系統點餐吧！！',
                icon: '/images/sufood.png',
                badge: '/images/sufood.png',
                requireInteraction: true,
                tag: 'su-food-order',
                renotify: true,
                vibrate: [500, 250, 500, 250, 500]
            }
        }    };

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
            const errMsg = resp.error?.message;
            
            // 💡 修正 4：把真正的失敗原因印出來，不再瞎猜！
            console.error(`❌ Token ${idx + 1} 發送失敗 | 代碼: ${errCode} | 原因: ${errMsg}`);
            
            // 將常見的無效錯誤都列入清除名單
            if (errCode === 'messaging/invalid-registration-token' ||
                errCode === 'messaging/registration-token-not-registered' ||
                errCode === 'messaging/invalid-argument') {
              failedTokens.push(chunkTokens[idx]);
            }
          }
        });
      }
    }

    console.log(`✅ 成功發送 ${successCount} 則通知，失敗 ${failureCount} 則。`);

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

sendNotification();
