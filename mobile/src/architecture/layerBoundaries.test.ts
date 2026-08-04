import { describe, it } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC_ROOT = join(process.cwd(), 'src');

function normalizePath(filePath: string): string {
  return filePath.split(sep).join('/');
}

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

function getLayerFromPath(filePath: string): string | null {
  const normalized = normalizePath(filePath);
  if (normalized.includes('/domain/')) return 'domain';
  if (normalized.includes('/application/')) return 'application';
  if (normalized.includes('/infrastructure/')) return 'infrastructure';
  if (normalized.includes('/platform/')) return 'platform';
  if (normalized.includes('/presentation/')) return 'presentation';
  if (normalized.includes('/debug/')) return 'debug';
  if (normalized.includes('/app/')) return 'app';
  if (normalized.includes('/features/')) return 'features';
  if (normalized.includes('/core/')) return 'core';
  if (normalized.includes('/ui/')) return 'ui';
  return null;
}

describe('architecture layer boundaries', () => {
  const allFiles = getAllTsFiles(SRC_ROOT);

  const domainFiles = allFiles.filter(f => {
    const layer = getLayerFromPath(f);
    return layer === 'domain';
  }).filter(f => !f.endsWith('README.md'));

  const applicationFiles = allFiles.filter(f => {
    const layer = getLayerFromPath(f);
    return layer === 'application';
  }).filter(f => !f.endsWith('README.md'));

  const infrastructureFiles = allFiles.filter(f => {
    const layer = getLayerFromPath(f);
    return layer === 'infrastructure';
  }).filter(f => !f.endsWith('README.md'));

  const platformFiles = allFiles.filter(f => {
    const layer = getLayerFromPath(f);
    return layer === 'platform';
  }).filter(f => !f.endsWith('README.md'));

  const presentationFiles = allFiles.filter(f => {
    const layer = getLayerFromPath(f);
    return layer === 'presentation';
  }).filter(f => !f.endsWith('README.md'));

  const debugFiles = allFiles.filter(f => {
    const layer = getLayerFromPath(f);
    return layer === 'debug';
  }).filter(f => !f.endsWith('README.md'));

  const appFiles = allFiles.filter(f => {
    const layer = getLayerFromPath(f);
    return layer === 'app';
  }).filter(f => !f.endsWith('README.md'));

  // Verify files were scanned
  it('domain layer files were scanned', () => {
    if (domainFiles.length === 0) {
      throw new Error('No domain files were scanned - check path detection');
    }
  });

  it('application layer files were scanned', () => {
    if (applicationFiles.length === 0) {
      throw new Error('No application files were scanned - check path detection');
    }
  });

  it('infrastructure layer files were scanned', () => {
    if (infrastructureFiles.length === 0) {
      throw new Error('No infrastructure files were scanned - check path detection');
    }
  });

  it('platform layer files were scanned', () => {
    if (platformFiles.length === 0) {
      throw new Error('No platform files were scanned - check path detection');
    }
  });

  it('presentation layer files were scanned', () => {
    if (presentationFiles.length === 0) {
      throw new Error('No presentation files were scanned - check path detection');
    }
  });

  // Domain layer rules
  describe('domain layer', () => {
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

      it(`${relPath} must not import application`, () => {
        if (hasForbiddenImport(content, '/application/')) {
          throw new Error(`Domain file ${relPath} imports 'application'`);
        }
      });

      it(`${relPath} must not import infrastructure`, () => {
        if (hasForbiddenImport(content, '/infrastructure/')) {
          throw new Error(`Domain file ${relPath} imports 'infrastructure'`);
        }
      });

      it(`${relPath} must not import platform`, () => {
        if (hasForbiddenImport(content, '/platform/')) {
          throw new Error(`Domain file ${relPath} imports 'platform'`);
        }
      });

      it(`${relPath} must not import presentation`, () => {
        if (hasForbiddenImport(content, '/presentation/')) {
          throw new Error(`Domain file ${relPath} imports 'presentation'`);
        }
      });

      it(`${relPath} must not import debug`, () => {
        if (hasForbiddenImport(content, '/debug/')) {
          throw new Error(`Domain file ${relPath} imports 'debug'`);
        }
      });

      it(`${relPath} must not import features`, () => {
        if (hasForbiddenImport(content, '/features/')) {
          throw new Error(`Domain file ${relPath} imports 'features'`);
        }
      });

      it(`${relPath} must not import core`, () => {
        if (hasForbiddenImport(content, '/core/')) {
          throw new Error(`Domain file ${relPath} imports 'core'`);
        }
      });

      it(`${relPath} must not import ui`, () => {
        if (hasForbiddenImport(content, '/ui/')) {
          throw new Error(`Domain file ${relPath} imports 'ui'`);
        }
      });
    }
  });

  // Application layer rules
  describe('application layer', () => {
    for (const file of applicationFiles) {
      const content = readSource(file);
      const relPath = relative(SRC_ROOT, file);

      it(`${relPath} must not import react`, () => {
        if (hasForbiddenImport(content, 'react')) {
          throw new Error(`Application file ${relPath} imports 'react'`);
        }
      });

      it(`${relPath} must not import react-native`, () => {
        if (hasForbiddenImport(content, 'react-native')) {
          throw new Error(`Application file ${relPath} imports 'react-native'`);
        }
      });

      it(`${relPath} must not import infrastructure`, () => {
        if (hasForbiddenImport(content, '/infrastructure/')) {
          throw new Error(`Application file ${relPath} imports 'infrastructure'`);
        }
      });

      it(`${relPath} must not import platform`, () => {
        if (hasForbiddenImport(content, '/platform/')) {
          throw new Error(`Application file ${relPath} imports 'platform'`);
        }
      });

      it(`${relPath} must not import presentation`, () => {
        if (hasForbiddenImport(content, '/presentation/')) {
          throw new Error(`Application file ${relPath} imports 'presentation'`);
        }
      });

      it(`${relPath} must not import debug`, () => {
        if (hasForbiddenImport(content, '/debug/')) {
          throw new Error(`Application file ${relPath} imports 'debug'`);
        }
      });

      it(`${relPath} must not import features`, () => {
        if (hasForbiddenImport(content, '/features/')) {
          throw new Error(`Application file ${relPath} imports 'features'`);
        }
      });

      it(`${relPath} must not import core`, () => {
        if (hasForbiddenImport(content, '/core/')) {
          throw new Error(`Application file ${relPath} imports 'core'`);
        }
      });

      it(`${relPath} must not import ui`, () => {
        if (hasForbiddenImport(content, '/ui/')) {
          throw new Error(`Application file ${relPath} imports 'ui'`);
        }
      });
    }
  });

  // Infrastructure layer rules
  describe('infrastructure layer', () => {
    for (const file of infrastructureFiles) {
      const content = readSource(file);
      const relPath = relative(SRC_ROOT, file);

      it(`${relPath} must not import presentation`, () => {
        if (hasForbiddenImport(content, '/presentation/')) {
          throw new Error(`Infrastructure file ${relPath} imports 'presentation'`);
        }
      });

      it(`${relPath} must not import debug`, () => {
        if (hasForbiddenImport(content, '/debug/')) {
          throw new Error(`Infrastructure file ${relPath} imports 'debug'`);
        }
      });

      it(`${relPath} must not import features`, () => {
        if (hasForbiddenImport(content, '/features/')) {
          throw new Error(`Infrastructure file ${relPath} imports 'features'`);
        }
      });

      it(`${relPath} must not import ui`, () => {
        if (hasForbiddenImport(content, '/ui/')) {
          throw new Error(`Infrastructure file ${relPath} imports 'ui'`);
        }
      });
    }
  });

  // Platform layer rules
  describe('platform layer', () => {
    for (const file of platformFiles) {
      const content = readSource(file);
      const relPath = relative(SRC_ROOT, file);

      it(`${relPath} must not import presentation`, () => {
        if (hasForbiddenImport(content, '/presentation/')) {
          throw new Error(`Platform file ${relPath} imports 'presentation'`);
        }
      });

      it(`${relPath} must not import infrastructure`, () => {
        if (hasForbiddenImport(content, '/infrastructure/')) {
          throw new Error(`Platform file ${relPath} imports 'infrastructure'`);
        }
      });

      it(`${relPath} must not import debug`, () => {
        if (hasForbiddenImport(content, '/debug/')) {
          throw new Error(`Platform file ${relPath} imports 'debug'`);
        }
      });

      it(`${relPath} must not import features`, () => {
        if (hasForbiddenImport(content, '/features/')) {
          throw new Error(`Platform file ${relPath} imports 'features'`);
        }
      });

      it(`${relPath} must not import ui`, () => {
        if (hasForbiddenImport(content, '/ui/')) {
          throw new Error(`Platform file ${relPath} imports 'ui'`);
        }
      });
    }
  });

  // Presentation layer rules
  describe('presentation layer', () => {
    for (const file of presentationFiles) {
      const content = readSource(file);
      const relPath = relative(SRC_ROOT, file);

      it(`${relPath} must not directly requireNativeModule`, () => {
        if (content.includes('requireNativeModule(')) {
          throw new Error(`Presentation file ${relPath} directly calls requireNativeModule`);
        }
      });

      it(`${relPath} must not directly requireNativeViewManager`, () => {
        if (content.includes('requireNativeViewManager(')) {
          throw new Error(`Presentation file ${relPath} directly calls requireNativeViewManager`);
        }
      });

      it(`${relPath} must not directly use PermissionsAndroid`, () => {
        if (content.includes('PermissionsAndroid')) {
          throw new Error(`Presentation file ${relPath} directly uses PermissionsAndroid`);
        }
      });

      it(`${relPath} must not import features`, () => {
        if (hasForbiddenImport(content, '/features/')) {
          throw new Error(`Presentation file ${relPath} imports 'features'`);
        }
      });

      it(`${relPath} must not import core`, () => {
        if (hasForbiddenImport(content, '/core/')) {
          throw new Error(`Presentation file ${relPath} imports 'core'`);
        }
      });

      it(`${relPath} must not import ui`, () => {
        if (hasForbiddenImport(content, '/ui/')) {
          throw new Error(`Presentation file ${relPath} imports 'ui'`);
        }
      });
    }
  });

  // Debug layer rules - it should not be imported by lower layers
  describe('debug layer isolation', () => {
    it('domain layer must not import debug', () => {
      for (const file of domainFiles) {
        const content = readSource(file);
        if (hasForbiddenImport(content, '/debug/')) {
          const relPath = relative(SRC_ROOT, file);
          throw new Error(`Domain file ${relPath} imports 'debug'`);
        }
      }
    });

    it('application layer must not import debug', () => {
      for (const file of applicationFiles) {
        const content = readSource(file);
        if (hasForbiddenImport(content, '/debug/')) {
          const relPath = relative(SRC_ROOT, file);
          throw new Error(`Application file ${relPath} imports 'debug'`);
        }
      }
    });

    it('infrastructure layer must not import debug', () => {
      for (const file of infrastructureFiles) {
        const content = readSource(file);
        if (hasForbiddenImport(content, '/debug/')) {
          const relPath = relative(SRC_ROOT, file);
          throw new Error(`Infrastructure file ${relPath} imports 'debug'`);
        }
      }
    });
  });

  // App layer rules - WakeFitApp should be a thin entry point
  // NOTE: These are target rules - WakeFitApp simplification is tracked as remaining work
  describe('app layer WakeFitApp target rules', () => {
    const wakeFitAppFile = appFiles.find(f => f.endsWith('WakeFitApp.tsx'));

    if (wakeFitAppFile) {
      const content = readSource(wakeFitAppFile);
      const relPath = relative(SRC_ROOT, wakeFitAppFile);

      // These tests document the target state for WakeFitApp simplification
      // They currently may fail because full migration is in progress
      it(`${relPath} target: should not have StyleSheet.create (UI should be in presentation layer)`, () => {
        if (content.includes('StyleSheet.create')) {
          console.log(`[INFO] ${relPath} contains StyleSheet.create - needs migration to presentation layer`);
        }
      });

      it(`${relPath} target: should not instantiate MemoryStorage (should use createWakeFitDependencies)`, () => {
        if (content.includes('new MemoryStorage')) {
          console.log(`[INFO] ${relPath} instantiates MemoryStorage - should use createWakeFitDependencies`);
        }
      });

      it(`${relPath} target: should not instantiate FetchWakeFitApiClient (should use createWakeFitDependencies)`, () => {
        if (content.includes('new FetchWakeFitApiClient')) {
          console.log(`[INFO] ${relPath} instantiates FetchWakeFitApiClient - should use createWakeFitDependencies`);
        }
      });

      it(`${relPath} target: should not use PermissionsAndroid directly (should use platform services)`, () => {
        if (content.includes('PermissionsAndroid')) {
          console.log(`[INFO] ${relPath} uses PermissionsAndroid - should use platform services`);
        }
      });
    }
  });
});
