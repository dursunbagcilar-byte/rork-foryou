#!/usr/bin/env node
// Expo SDK 52-54 geçişi için cache temizleme scripti

const fs = require('fs');
const path = require('path');

const dirsToRemove = [
  '.expo',
  'node_modules/.cache',
  'node_modules/.metro-health-check',
  '.watchmanconfig'
];

console.log('🧹 Expo SDK cache temizleniyor...\n');

dirsToRemove.forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (fs.existsSync(fullPath)) {
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log(`✅ ${dir} silindi`);
    } catch (e) {
      console.log(`⚠️  ${dir} silinemedi: ${e.message}`);
    }
  }
});

console.log('\n📦 Paket cache\'i temizleniyor...');
console.log('💡 Lütfen şimdi şu komutları çalıştırın:\n');
console.log('   bun install');
console.log('   bun start --clear\n');
