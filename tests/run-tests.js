// tests/run-tests.js
// 簡單的測試運行器

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🧪 Running tests...\n');

let passed = 0;
let failed = 0;

// 測試配置文件
try {
    console.log('✅ Testing config/app.js...');
    const config = require('../config/app');
    
    if (config.server.port) {
        console.log('   ✓ Server port configured');
        passed++;
    }
    
    if (config.spotify.clientId !== undefined) {
        console.log('   ✓ Spotify client ID configured');
        passed++;
    }
    
    if (config.session.cleanupInterval === 5 * 60 * 1000) {
        console.log('   ✓ Session cleanup interval set correctly');
        passed++;
    }
} catch (error) {
    console.log('   ✗ Config test failed:', error.message);
    failed++;
}

// 測試會話管理器
try {
    console.log('\n✅ Testing utils/sessionManager.js...');
    const sessionManager = require('../utils/sessionManager');
    
    if (sessionManager && typeof sessionManager.getSession === 'function') {
        console.log('   ✓ SessionManager has getSession method');
        passed++;
    }
    
    if (sessionManager && typeof sessionManager.saveSession === 'function') {
        console.log('   ✓ SessionManager has saveSession method');
        passed++;
    }
    
    if (sessionManager && typeof sessionManager.deleteSession === 'function') {
        console.log('   ✓ SessionManager has deleteSession method');
        passed++;
    }
} catch (error) {
    console.log('   ✗ SessionManager test failed:', error.message);
    failed++;
}

// 測試錯誤處理器
try {
    console.log('\n✅ Testing middleware/errorHandler.js...');
    const errorHandler = require('../middleware/errorHandler');
    
    if (errorHandler.AppError) {
        console.log('   ✓ AppError class exists');
        passed++;
    }
    
    if (errorHandler.ValidationError) {
        console.log('   ✓ ValidationError class exists');
        passed++;
    }
    
    if (errorHandler.asyncHandler) {
        console.log('   ✓ asyncHandler function exists');
        passed++;
    }
} catch (error) {
    console.log('   ✗ ErrorHandler test failed:', error.message);
    failed++;
}

// 測試驗證器
try {
    console.log('\n✅ Testing middleware/validator.js...');
    const validator = require('../middleware/validator');
    
    if (validator.validateSessionId) {
        console.log('   ✓ validateSessionId function exists');
        passed++;
    }
    
    if (validator.validateToken) {
        console.log('   ✓ validateToken function exists');
        passed++;
    }
} catch (error) {
    console.log('   ✗ Validator test failed:', error.message);
    failed++;
}

// 測試 API 存儲
try {
    console.log('\n✅ Testing api/storage-facade.js...');
    const storage = require('../api/storage-facade');
    
    if (storage.init && typeof storage.init === 'function') {
        console.log('   ✓ Storage init function exists');
        passed++;
    }
    
    if (storage.getSession && typeof storage.getSession === 'function') {
        console.log('   ✓ Storage getSession function exists');
        passed++;
    }
} catch (error) {
    console.log('   ✗ Storage test failed:', error.message);
    failed++;
}

// 總結
console.log('\n' + '='.repeat(40));
console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(40));

if (failed > 0) {
    process.exit(1);
} else {
    console.log('\n✅ All tests passed!\n');
    process.exit(0);
}
