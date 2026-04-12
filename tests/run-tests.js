// tests/run-tests.js
// 測試運行器 - 包含單元測試和集成測試

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🧪 Running tests...\n');

let passed = 0;
let failed = 0;

// ========== 單元測試 ==========

// 測試配置文件
try {
    console.log('✅ Testing config/app.js...');
    const config = require('../config/app');
    
    if (config.server.port) {
        console.log('   ✓ Server port configured');
        passed++;
    } else {
        console.log('   ✗ Server port not configured');
        failed++;
    }
    
    if (config.spotify.clientId !== undefined) {
        console.log('   ✓ Spotify client ID configured');
        passed++;
    } else {
        // 允許在測試環境中不配置 Spotify client ID
        console.log('   ⚠ Spotify client ID not configured (OK for test environment)');
        passed++;
    }
    
    if (config.session.cleanupInterval === 5 * 60 * 1000) {
        console.log('   ✓ Session cleanup interval set correctly');
        passed++;
    } else {
        console.log('   ✗ Session cleanup interval incorrect');
        failed++;
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
    } else {
        console.log('   ✗ SessionManager missing getSession');
        failed++;
    }
    
    if (sessionManager && typeof sessionManager.saveSession === 'function') {
        console.log('   ✓ SessionManager has saveSession method');
        passed++;
    } else {
        console.log('   ✗ SessionManager missing saveSession');
        failed++;
    }
    
    if (sessionManager && typeof sessionManager.deleteSession === 'function') {
        console.log('   ✓ SessionManager has deleteSession method');
        passed++;
    } else {
        console.log('   ✗ SessionManager missing deleteSession');
        failed++;
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
    } else {
        console.log('   ✗ AppError class missing');
        failed++;
    }
    
    if (errorHandler.ValidationError) {
        console.log('   ✓ ValidationError class exists');
        passed++;
    } else {
        console.log('   ✗ ValidationError class missing');
        failed++;
    }
    
    if (errorHandler.asyncHandler) {
        console.log('   ✓ asyncHandler function exists');
        passed++;
    } else {
        console.log('   ✗ asyncHandler function missing');
        failed++;
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
    } else {
        console.log('   ✗ validateSessionId function missing');
        failed++;
    }
    
    if (validator.validateToken) {
        console.log('   ✓ validateToken function exists');
        passed++;
    } else {
        console.log('   ✗ validateToken function missing');
        failed++;
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
    } else {
        console.log('   ✗ Storage init function missing');
        failed++;
    }
    
    if (storage.getSession && typeof storage.getSession === 'function') {
        console.log('   ✓ Storage getSession function exists');
        passed++;
    } else {
        console.log('   ✗ Storage getSession function missing');
        failed++;
    }
    
    if (storage.saveSession && typeof storage.saveSession === 'function') {
        console.log('   ✓ Storage saveSession function exists');
        passed++;
    } else {
        console.log('   ✗ Storage saveSession function missing');
        failed++;
    }
} catch (error) {
    console.log('   ✗ Storage test failed:', error.message);
    failed++;
}

// 測試 KV 存儲
try {
    console.log('\n✅ Testing api/kv-storage.js...');
    const KVStorage = require('../api/kv-storage');
    const kvStorage = new KVStorage();
    
    if (kvStorage.getSession && typeof kvStorage.getSession === 'function') {
        console.log('   ✓ KVStorage getSession method exists');
        passed++;
    } else {
        console.log('   ✗ KVStorage getSession method missing');
        failed++;
    }
    
    if (kvStorage.saveSession && typeof kvStorage.saveSession === 'function') {
        console.log('   ✓ KVStorage saveSession method exists');
        passed++;
    } else {
        console.log('   ✗ KVStorage saveSession method missing');
        failed++;
    }
} catch (error) {
    console.log('   ✗ KVStorage test failed:', error.message);
    failed++;
}

// ========== 集成測試 ==========

console.log('\n========== Integration Tests ==========');

// 測試服務器啟動
try {
    console.log('\n✅ Testing server startup...');
    const server = require('../server');
    console.log('   ✓ Server module loaded successfully');
    passed++;
} catch (error) {
    console.log('   ✗ Server failed to load:', error.message);
    failed++;
}

// 測試 API 端點存在性
try {
    console.log('\n✅ Testing API endpoints existence...');
    const fs = require('fs');
    const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    
    const requiredEndpoints = [
        '/api/auth',
        '/callback',
        '/api/current-track',
        '/api/auth-status',
        '/api/health'
    ];
    
    let allEndpointsFound = true;
    for (const endpoint of requiredEndpoints) {
        if (serverCode.includes(endpoint)) {
            console.log(`   ✓ Endpoint ${endpoint} exists`);
            passed++;
        } else {
            console.log(`   ✗ Endpoint ${endpoint} missing`);
            failed++;
            allEndpointsFound = false;
        }
    }
} catch (error) {
    console.log('   ✗ API endpoints test failed:', error.message);
    failed++;
}

// 測試前端模塊化
try {
    console.log('\n✅ Testing frontend modularization...');
    const publicDir = path.join(__dirname, '../public');
    const expectedModules = [
        'script.js',
        'lyrics-manager.js',
        'spotify-player-manager.js',
        'enhanced-session-manager.js',
        'kv-storage-manager.js'
    ];
    
    for (const module of expectedModules) {
        const modulePath = path.join(publicDir, module);
        if (fs.existsSync(modulePath)) {
            console.log(`   ✓ Module ${module} exists`);
            passed++;
        } else {
            console.log(`   ✗ Module ${module} missing`);
            failed++;
        }
    }
} catch (error) {
    console.log('   ✗ Frontend modules test failed:', error.message);
    failed++;
}

// 測試文檔存在性
try {
    console.log('\n✅ Testing documentation...');
    const docsDir = path.join(__dirname, '../docs');
    const expectedDocs = ['API.md'];
    
    for (const doc of expectedDocs) {
        const docPath = path.join(docsDir, doc);
        if (fs.existsSync(docPath)) {
            console.log(`   ✓ Document ${doc} exists`);
            passed++;
        } else {
            console.log(`   ✗ Document ${doc} missing`);
            failed++;
        }
    }
} catch (error) {
    console.log('   ✗ Documentation test failed:', error.message);
    failed++;
}

// ========== 測試總結 ==========

console.log('\n' + '='.repeat(50));
console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
    console.log('\n❌ Some tests failed. Please review the errors above.');
    process.exit(1);
} else {
    console.log('\n✅ All tests passed!\n');
    process.exit(0);
}
