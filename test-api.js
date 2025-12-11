// Simple test script to verify API endpoints
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:4000',
  headers: {
    'Content-Type': 'application/json'
  }
});

async function testAPI() {
  console.log('🧪 Testing Skill Exchange API...\n');
  
  try {
    // Test 1: Check server is running
    console.log('1. Testing server connection...');
    const healthCheck = await api.get('/');
    console.log('✅ Server is running:', healthCheck.data);
    
    // Test 2: Get all skills (should work without auth)
    console.log('\n2. Testing /skills endpoint...');
    const skillsResponse = await api.get('/skills');
    console.log('✅ Skills endpoint working. Found', skillsResponse.data.length, 'skills');
    
    // Test 3: Try to register a test user
    console.log('\n3. Testing registration...');
    const testUser = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
      mobile: '1234567890',
      age: 25,
      profession: 'Developer'
    };
    
    try {
      const registerResponse = await api.post('/register', testUser);
      console.log('✅ Registration successful:', registerResponse.data);
    } catch (regError) {
      if (regError.response?.status === 409) {
        console.log('ℹ️ User already exists, proceeding to login test...');
      } else {
        throw regError;
      }
    }
    
    // Test 4: Try to login
    console.log('\n4. Testing login...');
    const loginResponse = await api.post('/login', {
      email: 'test@example.com',
      password: 'password123'
    });
    console.log('✅ Login successful! Got token:', loginResponse.data.token?.substring(0, 20) + '...');
    console.log('✅ User data:', loginResponse.data.user);
    
    // Test 5: Use token to access protected endpoint
    console.log('\n5. Testing authenticated request...');
    const token = loginResponse.data.token;
    api.defaults.headers.Authorization = `Bearer ${token}`;
    
    const meResponse = await api.get('/me');
    console.log('✅ /me endpoint working:', meResponse.data);
    
    // Test 6: Test wants endpoint
    console.log('\n6. Testing wants endpoint...');
    const wantsResponse = await api.get('/wants/me');
    console.log('✅ Wants endpoint working. Found', wantsResponse.data.length, 'wants');
    
    console.log('\n🎉 All tests passed! API is working correctly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    console.error('Status:', error.response?.status);
    console.error('URL:', error.config?.url);
  }
}

// Run the test
testAPI();