import { describe, it } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(process.cwd(), 'src');

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }
  return files;
}

function readSource(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function hasForbiddenImport(content: string, forbidden: string): boolean {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (trimmed.includes(`from '${forbidden}'`) || trimmed.includes(`from "${forbidden}"`)) {
      return true;
    }
    if (trimmed.includes(`require('${forbidden}')`) || trimmed.includes(`require("${forbidden}")`)) {
      return true;
    }
  }
  return false;
}

describe('architecture layer boundaries', () => {
  const allFiles = getAllTsFiles(SRC_ROOT);

  const domainFiles = allFiles.filter(f => f.includes('/domain/') && !f.endsWith('README.md'));
  const applicationFiles = allFiles.filter(f => f.includes('/application/') && !f.endsWith('README.md'));
  const featuresFiles = allFiles.filter(f => f.includes('/features/') && !f.endsWith('README.md'));

  for (const file of domainFiles) {
    const content = readSource(file);
    const relPath = relative(SRC_ROOT, file);

    it(`${relPath} must not import react`, () => {
      if (hasForbiddenImport(content, 'react')) {
        throw new Error(`Domain file ${relPath} imports 'react'`);
      }
    });

    it(`${relPath} must not import react-native`, () => {
      if (hasForbiddenImport(content, 'react-native')) {
        throw new Error(`Domain file ${relPath} imports 'react-native'`);
      }
    });

    it(`${relPath} must not import expo-modules-core`, () => {
      if (hasForbiddenImport(content, 'expo-modules-core')) {
        throw new Error(`Domain file ${relPath} imports 'expo-modules-core'`);
      }
    });
  }

  for (const file of applicationFiles) {
    const content = readSource(file);
    const relPath = relative(SRC_ROOT, file);

    it(`${relPath} must not import react-native components`, () => {
      const forbiddenReactNative = [
        'from \'react-native\'',
        'from "react-native"'
      ];
      for (const pattern of forbiddenReactNative) {
        if (content.includes(pattern) && (content.includes('View') || content.includes('Text') || content.includes('StyleSheet'))) {
          throw new Error(`Application file ${relPath} imports React Native components`);
        }
      }
    });
  }
});
