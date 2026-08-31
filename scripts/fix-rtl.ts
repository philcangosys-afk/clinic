import fs from 'fs';
import path from 'path';

function walkDir(dir: string, callback: (path: string) => void) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

const map = {
  'text-left': 'text-end',
  'text-right': 'text-start', // text-start in RTL means right, which preserves the intention
  'border-l-': 'border-s-',
  'border-r-': 'border-e-',
  'border-l ': 'border-s ',
  'border-r ': 'border-e ',
  'border-l"': 'border-s"',
  'border-r"': 'border-e"',
  'flex-row': 'flex-row', // no need to change flex-row if dir="rtl" is applied
};

walkDir('./client', (filePath) => {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;
    
    for (const [key, val] of Object.entries(map)) {
      if (content.includes(key)) {
        content = content.split(key).join(val);
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated ${filePath}`);
    }
  }
});
