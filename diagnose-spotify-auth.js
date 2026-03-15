/**
 * Spotify Authentication Diagnostic Tool
 * 
 * 這個腳本用於診斷 Spotify API 授權問題
 * 使用方法：node diagnose-spotify-auth.js
 */

require('dotenv').config();
const axios = require('axios');

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/callback';

console.log('🔍 Spotify Authentication Diagnostic Tool\n');
console.log('='.repeat(50));

// 檢查環境變數
console.log('\n📋 檢查環境變數:');
if (!CLIENT_ID || CLIENT_ID === 'your_spotify_client_id_here') {
    console.log('❌ SPOTIFY_CLIENT_ID 未設置或無效');
} else {
    console.log('✅ SPOTIFY_CLIENT_ID 已設置');
}

if (!CLIENT_SECRET || CLIENT_SECRET === 'your_spotify_client_secret_here') {
    console.log('❌ SPOTIFY_CLIENT_SECRET 未設置或無效');
} else {
    console.log('✅ SPOTIFY_CLIENT_SECRET 已設置');
}

if (!REDIRECT_URI) {
    console.log('❌ REDIRECT_URI 未設置');
} else {
    console.log(`✅ REDIRECT_URI: ${REDIRECT_URI}`);
}

// 生成授權 URL
console.log('\n🔗 授權 URL 生成:');
const scopes = [
    'user-read-currently-playing',
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-playback-position',
    'user-read-private',
    'user-library-modify',
    'user-library-read',
    'playlist-read-private',
    'playlist-read-collaborative',
    'streaming'
].join(' ');

const authUrl = `https://accounts.spotify.com/authorize?` +
    `response_type=code&` +
    `client_id=${CLIENT_ID}&` +
    `scope=${encodeURIComponent(scopes)}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `state=diagnostic`;

console.log(`\n📱 請訪問以下 URL 重新授權:\n`);
console.log('─'.repeat(50));
console.log(authUrl);
console.log('─'.repeat(50));

console.log('\n📝 包含的 Scopes:');
scopes.split(' ').forEach((scope, index) => {
    console.log(`   ${index + 1}. ${scope}`);
});

console.log('\n💡 使用說明:');
console.log('1. 點擊上面的授權 URL');
console.log('2. 登入你的 Spotify 帳號');
console.log('3. 同意授權');
console.log('4. 如果成功，會被重定向到 callback URL，帶有 code 參數');
console.log('5. 複製 code 參數的值');

// 如果有提供 code，可以測試 token 交換
console.log('\n' + '='.repeat(50));
console.log('\n🔑 如果你想測試 Token 交換，請執行:');
console.log(`node diagnose-spotify-auth.js <code>`);
console.log('\n例如：node diagnose-spotify-auth.js AQDxxx...');

// 測試 API 呼叫
async function testSpotifyAPI(accessToken) {
    console.log('\n🧪 測試 Spotify API 呼叫:\n');
    
    const tests = [
        {
            name: '獲取用戶資料 (/v1/me)',
            url: 'https://api.spotify.com/v1/me',
            checkPremium: true
        },
        {
            name: '獲取播放器狀態 (/v1/me/player)',
            url: 'https://api.spotify.com/v1/me/player',
            checkPremium: true
        },
        {
            name: '獲取播放佇列 (/v1/me/player/queue)',
            url: 'https://api.spotify.com/v1/me/player/queue',
            checkPremium: true
        },
        {
            name: '獲取設備列表 (/v1/me/player/devices)',
            url: 'https://api.spotify.com/v1/me/player/devices',
            checkPremium: true
        }
    ];
    
    for (const test of tests) {
        try {
            const response = await axios.get(test.url, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            
            if (test.checkPremium && response.data.product) {
                console.log(`✅ ${test.name}`);
                if (response.data.product === 'premium') {
                    console.log(`   🎯 帳號類型：Premium`);
                } else {
                    console.log(`   ⚠️ 帳號類型：${response.data.product} (某些功能可能受限)`);
                }
            } else {
                console.log(`✅ ${test.name}`);
            }
        } catch (error) {
            const status = error.response?.status;
            const message = error.response?.data?.error?.message || error.message;
            
            if (status === 403) {
                console.log(`❌ ${test.name} - 403 Forbidden`);
                console.log(`   💬 ${message}`);
                if (test.name.includes('queue') || test.name.includes('Queue')) {
                    console.log(`   ⚠️ 這個 API 需要 Spotify Premium`);
                }
            } else if (status === 401) {
                console.log(`❌ ${test.name} - 401 Unauthorized (Token 可能過期)`);
            } else {
                console.log(`❌ ${test.name} - ${status || 'Error'}`);
                console.log(`   💬 ${message}`);
            }
        }
    }
}

// 主程式
async function main() {
    const code = process.argv[2];
    
    if (!code) {
        console.log('\n⚠️ 沒有提供 authorization code');
        console.log('請先訪問上面的授權 URL，然後用 code 參數執行此腳本');
        return;
    }
    
    console.log(`\n🔄 正在用 code 交換 token...`);
    
    try {
        const tokenResponse = await axios.post(
            'https://accounts.spotify.com/api/token',
            new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        
        console.log('\n✅ Token 交換成功!');
        console.log(`\n📋 Token 資訊:`);
        console.log(`   Access Token: ${tokenResponse.data.access_token.substring(0, 20)}...`);
        console.log(`   Refresh Token: ${tokenResponse.data.refresh_token ? tokenResponse.data.refresh_token.substring(0, 20) + '...' : 'N/A'}`);
        console.log(`   Expires In: ${tokenResponse.data.expires_in} 秒`);
        
        // 測試 API
        await testSpotifyAPI(tokenResponse.data.access_token);
        
    } catch (error) {
        console.log('\n❌ Token 交換失敗!');
        console.log(`狀態碼：${error.response?.status}`);
        console.log(`錯誤訊息：${error.response?.data?.error_description || error.message}`);
        
        if (error.response?.status === 400) {
            console.log('\n💡 可能的原因:');
            console.log('   1. Code 已過期（authorization code 只能使用一次）');
            console.log('   2. Code 無效');
            console.log('   3. REDIRECT_URI 與授權時不一致');
            console.log('   4. CLIENT_ID 或 CLIENT_SECRET 錯誤');
        }
    }
}

main();
